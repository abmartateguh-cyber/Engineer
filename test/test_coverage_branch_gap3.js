'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 3).
 *
 * Focuses on IPC handler validation chains (CAE, System, EDA). Every check
 * executes real production code paths (valid and invalid inputs) so that the
 * V8 block-transition branch proxy measures covered branch-target blocks.
 */

const assert = require('assert');

const {
  runTimoshenkoBeam,
  runShellMITC4,
  runContinuumPlasticity,
  runTransonicRiemann,
  runCfd2D,
  runDelaunayMesh3D,
  runFvmCfd3D,
  runSimpleCfdStep,
  runSparseCholesky,
  runWasmSparse,
  runGpuPcg,
  runWebGpuPressurePoisson,
  runHybridPrismTetMesh,
  runHex20Analysis
} = require('../src/main/ipc/cae_ipc');
const {
  processStenographerQuery,
  processLegacyMacroPrompt,
  loadOmniArchiveFromBuffer,
  normalizeSparseMatrixInput,
  handleGenericSparseSolve,
  handleRadauIIASolve
} = require('../src/main/ipc/system_ipc');
const {
  handleVerilogSynthesisRequest,
  handleSystemVerilogInspectionRequest,
  handleLefParseRequest,
  handleDefParseRequest,
  handleDefSerializeRequest,
  handleGerberExportRequest,
  handleDrcRequest,
  handleGdsiiExportRequest,
  handleGdsiiImportRequest,
  handleClockTreeRequest,
  handleBsim4VtcRequest
} = require('../src/main/ipc/eda_ipc');

function runBranchGapThreeCoverageTests() {
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

  const isInvalid = (out) => out && out.success === false && out.validationLevel === 'experimental';

  // ---------------------------------------------------------------
  // CAE IPC handlers: validation chains and success paths
  // ---------------------------------------------------------------
  check('runTimoshenkoBeam success and validation branches', () => {
    const ok = runTimoshenkoBeam({
      coords: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 }
      ],
      section: { E: 200e9, nu: 0.3, A: 0.01, Iy: 1e-5, Iz: 1e-5, J: 2e-5, ky: 0.833, kz: 0.833 },
      K: 1
    });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runTimoshenkoBeam({})));
    assert(
      isInvalid(
        runTimoshenkoBeam({
          coords: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 }
          ]
        })
      )
    );
    assert(
      isInvalid(
        runTimoshenkoBeam({
          coords: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 }
          ],
          section: { E: 200e9, nu: 0.3, A: 0.01, Iy: 1e-5, Iz: 1e-5, J: 2e-5, ky: 0.833, kz: 0.833 }
        })
      )
    );
    assert(
      isInvalid(
        runTimoshenkoBeam({
          coords: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 }
          ],
          section: { E: 200e9, nu: 0.3, A: 0.01, Iy: 1e-5, Iz: 1e-5, J: 2e-5, ky: 0.833, kz: 0.833 },
          K: 0
        })
      )
    );
  });

  check('runShellMITC4 success and validation branches', () => {
    const coords = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 }
    ];
    const ok = runShellMITC4({ coords, properties: { thickness: 0.01, E: 200e9, nu: 0.3 } });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runShellMITC4({})));
    assert(
      isInvalid(runShellMITC4({ coords: coords.slice(0, 3), properties: { thickness: 0.01, E: 200e9, nu: 0.3 } }))
    );
    assert(isInvalid(runShellMITC4({ coords, properties: { thickness: 0, E: 200e9, nu: 0.3 } })));
    assert(isInvalid(runShellMITC4({ coords, properties: { thickness: 0.01, E: 0, nu: 0.3 } })));
  });

  check('runContinuumPlasticity success and validation branches', () => {
    const material = {
      E: 200e9,
      nu: 0.3,
      yieldStress: 250e6,
      hardeningModulus: 1e9,
      A: 900e6,
      B: 200e6,
      n: 0.2,
      C: 0.01,
      m: 1,
      refStrainRate: 0.001,
      Tmelt: 1800,
      Troom: 300
    };
    const ok = runContinuumPlasticity({
      material,
      strainIncrement: [0.001, -0.0005, -0.0005, 0, 0, 0],
      strainRate: 0.001,
      temperature: 300
    });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runContinuumPlasticity({})));
    assert(
      isInvalid(
        runContinuumPlasticity({
          material: { ...material, E: 0 },
          strainIncrement: [0, 0, 0, 0, 0, 0],
          strainRate: 0.001,
          temperature: 300
        })
      )
    );
    assert(
      isInvalid(runContinuumPlasticity({ material, strainIncrement: [0, 0, 0], strainRate: 0.001, temperature: 300 }))
    );
    assert(
      isInvalid(
        runContinuumPlasticity({ material, strainIncrement: [0, 0, 0, 0, 0, 0], strainRate: 0, temperature: 300 })
      )
    );
    assert(
      isInvalid(
        runContinuumPlasticity({ material, strainIncrement: [0, 0, 0, 0, 0, 0], strainRate: 0.001, temperature: 0 })
      )
    );
  });

  check('runTransonicRiemann success and validation branches', () => {
    const okRoe = runTransonicRiemann({
      method: 'roe',
      leftState: { rho: 1, u: 0, v: 0, w: 0, p: 1 },
      rightState: { rho: 0.125, u: 0, v: 0, w: 0, p: 0.1 },
      normal: { x: 1, y: 0, z: 0 }
    });
    assert.strictEqual(okRoe.success, true);
    const okAusm = runTransonicRiemann({
      method: 'ausm',
      leftState: { rho: 1, u: 0, v: 0, w: 0, p: 1 },
      rightState: { rho: 0.125, u: 0, v: 0, w: 0, p: 0.1 },
      normal: { x: 1, y: 0, z: 0 }
    });
    assert.strictEqual(okAusm.success, true);
    const okShock = runTransonicRiemann({ method: 'shocktube', nCells: 100, tEnd: 0.1, cfl: 0.5 });
    assert.strictEqual(okShock.success, true);
    assert(isInvalid(runTransonicRiemann({})));
    assert(
      isInvalid(
        runTransonicRiemann({
          method: 'bogus',
          leftState: { rho: 1, u: 0, v: 0, w: 0, p: 1 },
          rightState: { rho: 0.125, u: 0, v: 0, w: 0, p: 0.1 },
          normal: { x: 1, y: 0, z: 0 }
        })
      )
    );
    assert(isInvalid(runTransonicRiemann({ method: 'shocktube', nCells: 1, tEnd: 0.1, cfl: 0.5 })));
    assert(isInvalid(runTransonicRiemann({ method: 'shocktube', nCells: 100, tEnd: 0, cfl: 0.5 })));
    assert(isInvalid(runTransonicRiemann({ method: 'shocktube', nCells: 100, tEnd: 0.1, cfl: 0 })));
  });

  check('runCfd2D success and validation branches', () => {
    const ok = runCfd2D({
      nx: 40,
      ny: 20,
      aoaDeg: 2,
      velocity: 10,
      chordRatio: 0.1,
      thicknessRatio: 0.12,
      iterations: 5
    });
    assert.strictEqual(ok.success, true);
    const base = { nx: 40, ny: 20, aoaDeg: 2, velocity: 10, chordRatio: 0.1, thicknessRatio: 0.12, iterations: 5 };
    assert(isInvalid(runCfd2D({})));
    assert(isInvalid(runCfd2D({ ...base, nx: 3 })));
    assert(isInvalid(runCfd2D({ ...base, ny: 3 })));
    assert(isInvalid(runCfd2D({ ...base, aoaDeg: NaN })));
    assert(isInvalid(runCfd2D({ ...base, velocity: 0 })));
    assert(isInvalid(runCfd2D({ ...base, chordRatio: 0 })));
    assert(isInvalid(runCfd2D({ ...base, thicknessRatio: 0 })));
    assert(isInvalid(runCfd2D({ ...base, iterations: 0 })));
  });

  check('runDelaunayMesh3D success and validation branches', () => {
    const vertices = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 }
    ];
    const faces = [
      [0, 1, 2],
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3]
    ];
    const ok = runDelaunayMesh3D({ vertices, faces, targetEdgeLength: 0.5, quadratic: false });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runDelaunayMesh3D({})));
    assert(
      isInvalid(runDelaunayMesh3D({ vertices: vertices.slice(0, 3), faces, targetEdgeLength: 0.5, quadratic: false }))
    );
    assert(isInvalid(runDelaunayMesh3D({ vertices, faces: [], targetEdgeLength: 0.5, quadratic: false })));
    assert(isInvalid(runDelaunayMesh3D({ vertices, faces, targetEdgeLength: 0, quadratic: false })));
    assert(isInvalid(runDelaunayMesh3D({ vertices, faces, targetEdgeLength: 0.5, quadratic: 'yes' })));
  });

  check('runFvmCfd3D success and validation branches', () => {
    const ok = runFvmCfd3D({
      nx: 4,
      ny: 4,
      nz: 4,
      lx: 1,
      ly: 1,
      lz: 1,
      inletVelocity: 1,
      steps: 1,
      omegaMRF: { x: 0, y: 0, z: 0 }
    });
    assert.strictEqual(ok.success, true);
    const base = {
      nx: 4,
      ny: 4,
      nz: 4,
      lx: 1,
      ly: 1,
      lz: 1,
      inletVelocity: 1,
      steps: 1,
      omegaMRF: { x: 0, y: 0, z: 0 }
    };
    assert(isInvalid(runFvmCfd3D({})));
    assert(isInvalid(runFvmCfd3D({ ...base, nx: 1 })));
    assert(isInvalid(runFvmCfd3D({ ...base, lx: 0 })));
    assert(isInvalid(runFvmCfd3D({ ...base, inletVelocity: 0 })));
    assert(isInvalid(runFvmCfd3D({ ...base, steps: 0 })));
    assert(isInvalid(runFvmCfd3D({ ...base, omegaMRF: { x: 0, y: 0 } })));
  });

  check('runSimpleCfdStep success and validation branches', () => {
    const ok = runSimpleCfdStep({
      cells: [
        [0, 0, 0],
        [1, 0, 0]
      ],
      faces: [[0, 1]]
    });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runSimpleCfdStep({})));
    assert(isInvalid(runSimpleCfdStep({ cells: [[0, 0, 0]], faces: [[0, 1]] })));
    assert(
      isInvalid(
        runSimpleCfdStep({
          cells: [
            [0, 0, 0],
            [1, 0, 0]
          ],
          faces: []
        })
      )
    );
  });

  check('runSparseCholesky success and validation branches', () => {
    const ok = runSparseCholesky({
      N: 3,
      triplets: [
        [0, 0, 4],
        [1, 1, 4],
        [2, 2, 4]
      ],
      b: [1, 2, 3]
    });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runSparseCholesky({})));
    assert(isInvalid(runSparseCholesky({ N: 0, triplets: [[0, 0, 4]], b: [] })));
    assert(isInvalid(runSparseCholesky({ N: 3, triplets: [[0, 0, 4]], b: [1, 2] })));
    assert(isInvalid(runSparseCholesky({ N: 3, triplets: [[0, 5, 4]], b: [1, 2, 3] })));
  });

  check('runWasmSparse success and validation branches', () => {
    const ok = runWasmSparse({
      N: 3,
      triplets: [
        [0, 0, 4],
        [1, 1, 4],
        [2, 2, 4]
      ],
      b: [1, 2, 3]
    });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runWasmSparse({})));
    assert(isInvalid(runWasmSparse({ N: 3, triplets: [[0, 5, 4]], b: [1, 2, 3] })));
    assert(isInvalid(runWasmSparse({ N: 3, triplets: [[0, 0, 4]], b: [1] })));
  });

  check('runGpuPcg success and validation branches', () => {
    const csr = { N: 2, rowPtr: [0, 1, 2], colIndices: [0, 1], values: [2, 3] };
    const ok = runGpuPcg({ csr, b: [1, 1] });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runGpuPcg({})));
    assert(isInvalid(runGpuPcg({ csr: { N: 2, rowPtr: [0, 1, 2], colIndices: [0, 1], values: [2, 3] }, b: [1] })));
    assert(isInvalid(runGpuPcg({ csr: { N: 2, rowPtr: [0, 1], colIndices: [0, 1], values: [2, 3] }, b: [1, 1] })));
    assert(isInvalid(runGpuPcg({ csr: { N: 2, rowPtr: [0, 1, 2], colIndices: [0], values: [2, 3] }, b: [1, 1] })));
  });

  check('runWebGpuPressurePoisson success and validation branches', () => {
    const ok = runWebGpuPressurePoisson({ nx: 4, ny: 4, maxIter: 10, b: Array(16).fill(1) });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runWebGpuPressurePoisson({})));
    assert(isInvalid(runWebGpuPressurePoisson({ nx: 1, ny: 4, maxIter: 10, b: Array(16).fill(1) })));
    assert(isInvalid(runWebGpuPressurePoisson({ nx: 4, ny: 4, maxIter: 0, b: Array(16).fill(1) })));
    assert(isInvalid(runWebGpuPressurePoisson({ nx: 4, ny: 4, maxIter: 10, b: Array(8).fill(1) })));
  });

  check('runHybridPrismTetMesh success and validation branches', () => {
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
    const ok = runHybridPrismTetMesh({
      surfaceMesh,
      prismOptions: { firstLayerHeight: 0.1, growthRatio: 1.2, layerCount: 2, maxCornerAngleRad: 0.8 },
      tetOptions: { targetEdgeLength: 0.4, quadratic: false }
    });
    assert.strictEqual(ok.success, true);
    assert(isInvalid(runHybridPrismTetMesh({})));
    assert(
      isInvalid(
        runHybridPrismTetMesh({
          surfaceMesh,
          prismOptions: { firstLayerHeight: 0, growthRatio: 1.2, layerCount: 2, maxCornerAngleRad: 0.8 },
          tetOptions: { targetEdgeLength: 0.4, quadratic: false }
        })
      )
    );
    assert(
      isInvalid(
        runHybridPrismTetMesh({
          surfaceMesh,
          prismOptions: { firstLayerHeight: 0.1, growthRatio: 1.2, layerCount: 2, maxCornerAngleRad: 0.8 },
          tetOptions: { targetEdgeLength: 0, quadratic: false }
        })
      )
    );
  });

  check('runHex20Analysis validation branches', () => {
    const coords = [];
    for (let i = 0; i < 20; i++) coords.push({ x: i * 0.01, y: i * 0.01, z: i * 0.01 });
    assert(isInvalid(runHex20Analysis({})));
    assert(
      isInvalid(
        runHex20Analysis({
          coords: coords.slice(0, 19),
          material: { E: 200e9, nu: 0.3, yieldStress: 250e6 },
          fixedNodes: [0],
          loadNode: 5,
          force: { x: 1, y: 0, z: 0 }
        })
      )
    );
    assert(
      isInvalid(
        runHex20Analysis({
          coords,
          material: { E: 0, nu: 0.3, yieldStress: 250e6 },
          fixedNodes: [0],
          loadNode: 5,
          force: { x: 1, y: 0, z: 0 }
        })
      )
    );
    assert(
      isInvalid(
        runHex20Analysis({
          coords,
          material: { E: 200e9, nu: 0.3, yieldStress: 250e6 },
          fixedNodes: [],
          loadNode: 5,
          force: { x: 1, y: 0, z: 0 }
        })
      )
    );
    assert(
      isInvalid(
        runHex20Analysis({
          coords,
          material: { E: 200e9, nu: 0.3, yieldStress: 250e6 },
          fixedNodes: [0],
          loadNode: 25,
          force: { x: 1, y: 0, z: 0 }
        })
      )
    );
    assert(
      isInvalid(
        runHex20Analysis({
          coords,
          material: { E: 200e9, nu: 0.3, yieldStress: 250e6 },
          fixedNodes: [0],
          loadNode: 5,
          force: { x: 1, y: 0 }
        })
      )
    );
  });

  // ---------------------------------------------------------------
  // System IPC exported functions
  // ---------------------------------------------------------------
  check('processStenographerQuery validation branches', () => {
    const empty = processStenographerQuery(null, null, { prompt: '  ' });
    assert.strictEqual(empty.success, false);
    const long = processStenographerQuery(null, null, { prompt: 'x'.repeat(9000) });
    assert.strictEqual(long.success, false);
    const none = processStenographerQuery(null, null, {});
    assert.strictEqual(none.success, false);
  });

  check('processLegacyMacroPrompt branches', () => {
    const empty = processLegacyMacroPrompt({ prompt: '  ' });
    assert.strictEqual(empty.success, false);
    const ok = processLegacyMacroPrompt({ prompt: 'list tools', context: {} });
    assert.strictEqual(ok.success, true);
  });

  check('loadOmniArchiveFromBuffer branches', () => {
    const nonBuf = loadOmniArchiveFromBuffer('nope');
    assert.strictEqual(nonBuf.success, false);
    const bad = loadOmniArchiveFromBuffer(Buffer.from('not an archive'));
    assert.strictEqual(bad.success, false);
  });

  check('normalizeSparseMatrixInput branches', () => {
    assert.deepStrictEqual(
      normalizeSparseMatrixInput(
        [
          [1, 0],
          [0, 1]
        ],
        2
      ),
      [
        [1, 0],
        [0, 1]
      ]
    );
    assert.strictEqual(normalizeSparseMatrixInput([[1, 0], [0]], 2), null);
    assert.strictEqual(
      normalizeSparseMatrixInput(
        [
          [1, 0],
          [0, 1]
        ],
        3
      ),
      null
    );
    assert.deepStrictEqual(normalizeSparseMatrixInput({ rows: 2, cols: 2, values: [1, 0, 0, 1] }, 2), [
      [1, 0],
      [0, 1]
    ]);
    assert.strictEqual(normalizeSparseMatrixInput({ rows: 2, cols: 2, values: [1, 0] }, 2), null);
    assert.strictEqual(normalizeSparseMatrixInput({ rows: 3, cols: 2, values: [1, 0, 0, 1] }, 2), null);
    assert.strictEqual(normalizeSparseMatrixInput(null, 2), null);
    assert.strictEqual(normalizeSparseMatrixInput('nope', 2), null);
  });

  check('handleGenericSparseSolve branches', () => {
    const ok = handleGenericSparseSolve({
      A: [
        [4, 0],
        [0, 4]
      ],
      b: [1, 2]
    });
    assert.strictEqual(ok.success, true);
    const badA = handleGenericSparseSolve({ A: [[4, 0], [0]], b: [1, 2] });
    assert.strictEqual(badA.success, false);
    const badB = handleGenericSparseSolve({
      A: [
        [4, 0],
        [0, 4]
      ],
      b: [1]
    });
    assert.strictEqual(badB.success, false);
    const badObj = handleGenericSparseSolve({ A: { rows: 2, cols: 2, values: [1, 0] }, b: [1, 2] });
    assert.strictEqual(badObj.success, false);
    const singular = handleGenericSparseSolve({
      A: [
        [1, 2],
        [2, 4]
      ],
      b: [1, 2]
    });
    assert.strictEqual(singular.success, false);
  });

  check('handleRadauIIASolve branches', () => {
    const badSys = handleRadauIIASolve({ system: 'bogus', t0: 0, tEnd: 1, y0: [1] });
    assert.strictEqual(badSys.success, false);
    const badT = handleRadauIIASolve({ system: 'decay', t0: 2, tEnd: 1, y0: [1] });
    assert.strictEqual(badT.success, false);
    const badY0 = handleRadauIIASolve({ system: 'decay', t0: 0, tEnd: 1, y0: [1, 2] });
    assert.strictEqual(badY0.success, false);
    const badY0v = handleRadauIIASolve({ system: 'vanderpol', t0: 0, tEnd: 1, y0: [1] });
    assert.strictEqual(badY0v.success, false);
    const ok = handleRadauIIASolve({ system: 'decay', t0: 0, tEnd: 1, y0: [1], rtol: 1e-6, atol: 1e-9 });
    assert.strictEqual(ok.success, true);
    const okV = handleRadauIIASolve({ system: 'vanderpol', t0: 0, tEnd: 0.5, y0: [2, 0] });
    assert.strictEqual(okV.success, true);
  });

  // ---------------------------------------------------------------
  // EDA IPC handlers
  // ---------------------------------------------------------------
  check('handleVerilogSynthesisRequest branches', () => {
    const empty = handleVerilogSynthesisRequest('  ');
    assert.strictEqual(empty.success, false);
    const unsupported = handleVerilogSynthesisRequest('module m; endmodule');
    assert.strictEqual(unsupported.success, false);
    assert.strictEqual(unsupported.status, 'unavailable');
  });

  check('handleSystemVerilogInspectionRequest branches', () => {
    const empty = handleSystemVerilogInspectionRequest('');
    assert.strictEqual(empty.success, false);
    const ok = handleSystemVerilogInspectionRequest('module m(input a, output y); assign y = a; endmodule');
    assert.strictEqual(ok.success, true);
  });

  check('handleLefParseRequest branches', () => {
    const nonRecord = handleLefParseRequest(null);
    assert.strictEqual(nonRecord.success, false);
    const empty = handleLefParseRequest({ content: ' ' });
    assert.strictEqual(empty.success, false);
    const ok = handleLefParseRequest({ content: 'VERSION 5.8 ;\nLAYER metal1 ;\nEND LIBRARY' });
    assert.strictEqual(ok.success, true);
  });

  check('handleDefParseRequest and serialize branches', () => {
    const empty = handleDefParseRequest({ content: '' });
    assert.strictEqual(empty.success, false);
    const nonRecord = handleDefSerializeRequest(null);
    assert.strictEqual(nonRecord.success, false);
    const okDef = handleDefParseRequest({
      content:
        'VERSION 5.8 ;\nDESIGN top ;\nUNITS DISTANCE MICRONS 1000 ;\nDIEAREA ( 0 0 ) ( 1000 1000 ) ;\nCOMPONENTS 0 ;\nEND COMPONENTS\nEND DESIGN'
    });
    assert.strictEqual(okDef.success, true);
    const okSer = handleDefSerializeRequest({
      defData: {
        name: 'top',
        unitsDistanceMicrons: 1000,
        dieArea: { x1: 0, y1: 0, x2: 1000, y2: 1000 },
        components: [],
        nets: []
      }
    });
    assert.strictEqual(okSer.success, true);
  });

  check('handleGerberExportRequest and handleDrcRequest branches', () => {
    assert.strictEqual(handleGerberExportRequest('x').success, false);
    assert.strictEqual(handleDrcRequest(null).success, false);
  });

  check('handleGdsiiExportRequest branches', () => {
    const base = {
      libName: 'lib',
      topCell: 'top',
      userUnits: 1e-3,
      dbUnits: 1e-3,
      polygons: [
        {
          layer: 1,
          datatype: 0,
          points: [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 0, y: 1000 }
          ]
        }
      ]
    };
    const ok = handleGdsiiExportRequest(base);
    assert.strictEqual(ok.success, true);
    assert.strictEqual(handleGdsiiExportRequest(null).success, false);
    assert.strictEqual(handleGdsiiExportRequest({ ...base, libName: '' }).success, false);
    assert.strictEqual(handleGdsiiExportRequest({ ...base, topCell: '  ' }).success, false);
    assert.strictEqual(handleGdsiiExportRequest({ ...base, userUnits: 0 }).success, false);
    assert.strictEqual(handleGdsiiExportRequest({ ...base, polygons: [] }).success, false);
    assert.strictEqual(
      handleGdsiiExportRequest({
        ...base,
        polygons: [
          {
            layer: 1.5,
            datatype: 0,
            points: [
              { x: 0, y: 0 },
              { x: 1000, y: 0 },
              { x: 0, y: 1000 }
            ]
          }
        ]
      }).success,
      false
    );
    assert.strictEqual(
      handleGdsiiExportRequest({
        ...base,
        polygons: [
          {
            layer: 1,
            datatype: 0,
            points: [
              { x: 0, y: 0 },
              { x: 0, y: 0 },
              { x: 0, y: 0 }
            ]
          }
        ]
      }).success,
      false
    );
    assert.strictEqual(
      handleGdsiiExportRequest({
        ...base,
        polygons: [
          {
            layer: 1,
            datatype: 0,
            points: [
              { x: 0, y: 0 },
              { x: 1000, y: 0 },
              { x: 0, y: 1000 },
              { x: 0.5, y: 0.5 }
            ]
          }
        ]
      }).success,
      false
    );
  });

  check('handleGdsiiImportRequest branches', () => {
    assert.strictEqual(handleGdsiiImportRequest('!!notbase64!!').success, false);
    assert.strictEqual(handleGdsiiImportRequest(Buffer.from([1, 2, 3])).success, false);
    assert.strictEqual(handleGdsiiImportRequest('').success, false);
  });

  check('handleClockTreeRequest branches', () => {
    const base = {
      sinks: [
        { id: 's1', x: 0, y: 0, capPf: 1 },
        { id: 's2', x: 10, y: 0, capPf: 1 }
      ],
      rootPosition: { x: 5, y: 5 },
      options: { targetSkewPs: 10, bufferDelayNs: 0.5, wireResistancePerUm: 0.01, wireCapacitancePerUmPf: 0.1 },
      routingGrid: { width: 100, height: 100, layers: 2 },
      routeStart: { x: 0, y: 0, layer: 0 },
      routeEnd: { x: 10, y: 0, layer: 1 }
    };
    const ok = handleClockTreeRequest(base);
    assert.strictEqual(ok.success, true);
    assert.strictEqual(handleClockTreeRequest({}).success, false);
    assert.strictEqual(handleClockTreeRequest({ ...base, sinks: [{ id: 's1', x: 0, y: 0, capPf: 1 }] }).success, false);
    assert.strictEqual(
      handleClockTreeRequest({
        ...base,
        sinks: [
          { id: 's1', x: 0, y: 0, capPf: 1 },
          { id: 's1', x: 1, y: 0, capPf: 1 }
        ]
      }).success,
      false
    );
    assert.strictEqual(
      handleClockTreeRequest({
        ...base,
        sinks: [
          { id: 's1', x: 0, y: 0, capPf: 0 },
          { id: 's2', x: 10, y: 0, capPf: 1 }
        ]
      }).success,
      false
    );
    assert.strictEqual(handleClockTreeRequest({ ...base, rootPosition: { x: NaN, y: 5 } }).success, false);
    assert.strictEqual(
      handleClockTreeRequest({ ...base, options: { targetSkewPs: 10, bufferDelayNs: 0.5, wireResistancePerUm: 0.01 } })
        .success,
      false
    );
    assert.strictEqual(
      handleClockTreeRequest({ ...base, routingGrid: { width: 0, height: 100, layers: 2 } }).success,
      false
    );
    assert.strictEqual(handleClockTreeRequest({ ...base, routeStart: { x: 200, y: 0, layer: 0 } }).success, false);
    assert.strictEqual(handleClockTreeRequest({ ...base, routeEnd: { x: 10, y: 0, layer: 5 } }).success, false);
  });

  check('handleBsim4VtcRequest branches', () => {
    const nmos = {
      type: 'nmos',
      W: 1e-6,
      L: 0.18e-6,
      tox: 4e-9,
      Vth0: 0.4,
      mu0: 500,
      vsat: 1e5,
      dibl_eta: 0.02,
      lambda: 0.02
    };
    const pmos = {
      type: 'pmos',
      W: 2e-6,
      L: 0.18e-6,
      tox: 4e-9,
      Vth0: -0.4,
      mu0: 200,
      vsat: 1e5,
      dibl_eta: 0.02,
      lambda: 0.02
    };
    const base = { nmos, pmos, bias: { vgsV: 1, vdsV: 1, vbsV: 0 }, vddV: 1.8, sweepPoints: 10 };
    const ok = handleBsim4VtcRequest(base);
    assert.strictEqual(ok.success, true);
    assert.strictEqual(handleBsim4VtcRequest({}).success, false);
    assert.strictEqual(handleBsim4VtcRequest({ ...base, nmos: { type: 'nmos' } }).success, false);
    assert.strictEqual(handleBsim4VtcRequest({ ...base, nmos: { ...nmos, W: 0 } }).success, false);
    assert.strictEqual(handleBsim4VtcRequest({ ...base, nmos: { ...nmos, Vth0: 0 } }).success, false);
    assert.strictEqual(handleBsim4VtcRequest({ ...base, bias: { vgsV: 1 } }).success, false);
    assert.strictEqual(handleBsim4VtcRequest({ ...base, vddV: 0 }).success, false);
    assert.strictEqual(handleBsim4VtcRequest({ ...base, sweepPoints: 1 }).success, false);
  });

  console.log('\n================================================================');
  console.log(`   BRANCH-GAP-3 RESULTS: ${passedTests}/${totalTests} passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapThreeCoverageTests };

if (require.main === module) {
  const stats = runBranchGapThreeCoverageTests();
  if (stats.failed > 0) process.exitCode = 1;
}
