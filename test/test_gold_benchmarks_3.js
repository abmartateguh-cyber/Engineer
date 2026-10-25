/**
 * OmniEng Legacy Engineering Module Smoke Suite 3.0
 * 30 internal calculation and module smoke checks
 *
 * Exercises legacy engineering examples; no independent validation is established:
 * - Pillar 1: Structured and sparse numerical helper examples
 * - Pillar 2: 2D/3D Variational Geometric Constraint Solver, Topological Healing & Persistent Naming
 * - Pillar 3: Multi-Scale Physical Solvers (Explicit Crash, Hyperelastic, Fatigue, VOF, Turbomachinery,
 *             CCS Timing, Crosstalk, Power Grid IR Drop, OASIS Stream, DLS Optical Optimization,
 *             Tolerancing Yield, Optical Glasses, Stateflow FSM, Simscape Networks, Dynamic Flowsheet, eNRTL)
 * - Pillar 4: CAD visual-diff and eBOM examples, a qualification-diagnostic helper, and experimental stress-line screening
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

const assert = require('assert');

// Import Pillar 1 & 2 Modules
const { WasmSparseMultifrontalSolver } = require('../src/core/math/wasm_sparse_multifrontal');
const { GPUParallelPCGSolver } = require('../src/core/math/gpu_parallel_pcg_solver');
const { VariationalConstraintSolver } = require('../src/core/cad/variational_constraint_solver');
const { TopologicalHealingEngine } = require('../src/core/cad/topological_healing_engine');
const { PersistentNamingManager } = require('../src/core/cad/persistent_naming_manager');

// Import Pillar 3 Modules
const { ExplicitDynamicsCrashSolver } = require('../src/core/cae/explicit_dynamics_crash');
const { HyperelasticMaterialModel } = require('../src/core/cae/hyperelastic_materials');
const { FatigueLifeAnalyzer } = require('../src/core/cae/fatigue_life_analyzer');
const { VOFMultiphaseSolver } = require('../src/core/cae/vof_multiphase_solver');
const { SlidingMeshTurbomachinery } = require('../src/core/cae/sliding_mesh_turbomachinery');
const { CCSTimingModel } = require('../src/core/eda/ccs_timing_model');
const { SignalIntegrityCrosstalk } = require('../src/core/eda/signal_integrity_crosstalk');
const { SYNTHETIC_CROSSTALK_INPUTS } = require('./support/experimental_eda_formula_inputs');
const { PowerGridIRDropAnalyzer } = require('../src/core/eda/power_grid_ir_drop');
const {
  createSyntheticPdnAnalyzer,
  createSyntheticPdnMesh,
  SYNTHETIC_BLACKS_MODEL
} = require('./support/experimental_pdn_inputs');
const { OasisStreamEngine } = require('../src/core/eda/oasis_stream_engine');
const { DampedLeastSquaresOptimizer } = require('../src/core/optics/damped_least_squares_optimizer');
const { TolerancingYieldCompensator } = require('../src/core/optics/tolerancing_yield_compensator');
const { OpticalGlassCatalog } = require('../src/core/optics/optical_glass_catalog');
const opticalExamples = require('./support/experimental_optics_examples');
const { StateflowFSMEngine } = require('../src/core/dynamic_simulink/stateflow_fsm_engine');
const { SimscapeDomainLibrary } = require('../src/core/dynamic_simulink/simscape_domain_library');
const { DynamicFlowsheetSolver } = require('../src/core/plant/dynamic_flowsheet_solver');
const { ElectrolyteNRTLModel } = require('../src/core/plant/enrtl_electrolyte_thermo');
const { WebGPUCFDKernel } = require('../src/core/cae/webgpu_cfd_kernel');
const { SFunctionPluginHost } = require('../src/core/dynamic_simulink/s_function_plugin_host');
const { PetroleumAssayCharacterizer } = require('../src/core/plant/petroleum_assay_characterizer');
const { measureStructuredPoissonBudget } = require('../src/core/vv/poisson_performance');

// Import Pillar 4 Modules
const { GitCADVisualDiffEngine } = require('../src/core/pdm/git_cad_visual_diff');
const { EngineeringBOMManager } = require('../src/core/pdm/engineering_bom_manager');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');
const { ASMESectionVIIIDiv2Analyzer } = require('../src/core/compliance/asme_section_viii_div2');

function runGoldRegulatoryBenchmarks3() {
  console.log('\n================================================================');
  console.log('   RUNNING 30 EXPERIMENTAL LEGACY SMOKE CHECKS      ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 30;

  // -------------------------------------------------------------
  // Benchmark 1: Variational Geometric Constraint Solver
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 1] 2D Variational Geometric Constraint Solver (Newton-Raphson SVD)...\n');
    const solver = new VariationalConstraintSolver();
    // Add points for a right-angle triangle with dimension constraints
    solver.addPoint('P1', 0, 0, true); // Fixed origin
    solver.addPoint('P2', 38.0, 2.0); // Near (40, 0)
    solver.addPoint('P3', 2.0, 28.0); // Near (0, 30)

    solver.addConstraint({ type: 'HORIZONTAL', point1: 'P1', point2: 'P2' });
    solver.addConstraint({ type: 'VERTICAL', point1: 'P1', point2: 'P3' });
    solver.addConstraint({ type: 'DISTANCE', point1: 'P1', point2: 'P2', value: 40.0 });
    solver.addConstraint({ type: 'DISTANCE', point1: 'P1', point2: 'P3', value: 30.0 });

    const res = solver.solve();
    assert.strictEqual(res.converged, true, 'Solver must converge');
    assert(res.residualNorm < 1e-10, `Residual norm ${res.residualNorm} must be < 1e-10`);
    assert(Math.abs(res.points.P2.x - 40.0) < 1e-8, 'P2.x should be 40.0');
    assert(Math.abs(res.points.P2.y - 0.0) < 1e-8, 'P2.y should be 0.0');
    assert(Math.abs(res.points.P3.x - 0.0) < 1e-8, 'P3.x should be 0.0');
    assert(Math.abs(res.points.P3.y - 30.0) < 1e-8, 'P3.y should be 30.0');

    console.log(
      `  ✓ PASSED: Solved 4 variational constraints in ${res.iterations} iterations, residual = ${res.residualNorm.toExponential(4)}`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 1: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 2: Topological Healing of Dirty Geometry
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 2] Tolerant Modeling & Micro-Gap Topological Healing Engine...\n');
    const healer = new TopologicalHealingEngine({ tolerance: 0.05 });
    // Model with micro-gaps and a sliver face
    const dirtyModel = {
      vertices: [
        { id: 'v1', x: 0.0, y: 0.0, z: 0.0 },
        { id: 'v2', x: 0.02, y: 0.01, z: 0.0 }, // Micro-gap duplicate with v1
        { id: 'v3', x: 10.0, y: 0.0, z: 0.0 },
        { id: 'v4', x: 10.0, y: 10.0, z: 0.0 },
        { id: 'v5', x: 0.0, y: 10.0, z: 0.0 }
      ],
      faces: [
        { id: 'f1', vertexIds: ['v1', 'v3', 'v4', 'v5'], area: 100.0, perimeter: 40.0 },
        { id: 'f_sliver', vertexIds: ['v1', 'v2', 'v3'], area: 0.0001, perimeter: 20.0 } // Degenerate sliver
      ]
    };

    const healed = healer.healSolid(dirtyModel);
    assert.strictEqual(healed.healed, true, 'Model must be healed');
    assert.strictEqual(healed.stitchedVerticesCount, 1, 'Duplicate micro-gap vertex must be stitched');
    assert.strictEqual(healed.collapsedSliverCount, 1, 'Sliver face must be collapsed');
    assert(healed.solid.faces.length === 1, 'Only clean manifold face f1 should remain');

    console.log(
      `  ✓ PASSED: Stitched ${healed.stitchedVerticesCount} micro-gap vertices and collapsed ${healed.collapsedSliverCount} sliver faces`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 2: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 3: Persistent Topological Naming
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 3] Persistent Topological Naming Across Parametric Re-Evaluations...\n');
    const pnm = new PersistentNamingManager();
    const face1 = pnm.registerEntity('FACE', {
      originatingFeatureId: 'Extrude1',
      geometryType: 'CYLINDRICAL',
      centroid: { x: 0, y: 0, z: 25 },
      normalOrAxis: { x: 0, y: 0, z: 1 },
      area: 785.4
    });

    // Perturb model during feature tree rebuild: centroid shifts from z=25 to z=30
    const reEvaluatedFace = {
      geometryType: 'CYLINDRICAL',
      centroid: { x: 0, y: 0, z: 30 },
      normalOrAxis: { x: 0, y: 0, z: 1 },
      area: 785.4
    };

    const resolved = pnm.resolveEntity(face1.persistentId, [reEvaluatedFace]);
    assert(resolved.matchFound, 'Persistent naming must track modified entity');
    assert(resolved.similarityScore >= 0.85, 'Similarity score should be >= 0.85');

    console.log(
      `  ✓ PASSED: Resolved persistent ID ${face1.persistentId.slice(0, 16)}... with similarity ${resolved.similarityScore.toFixed(3)}`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 3: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 4: Structured direct Poisson solve and generic sparse Cholesky
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 4] 2D Poisson DST-I direct path and generic sparse Cholesky...\n');
    const solver = new WasmSparseMultifrontalSolver();
    // 5x5 symmetric positive definite tridiagonal system
    const A = [
      [4, -1, 0, 0, 0],
      [-1, 4, -1, 0, 0],
      [0, -1, 4, -1, 0],
      [0, 0, -1, 4, -1],
      [0, 0, 0, -1, 4]
    ];
    const b = [3, 2, 2, 2, 3]; // Exact solution x = [1, 1, 1, 1, 1]

    const csr = solver.denseToCSR(A);
    const x = solver.solveCholesky(csr, b);

    for (let i = 0; i < 5; i++) {
      assert(Math.abs(x[i] - 1.0) < 1e-8, `Solution x[${i}] should be 1.0, got ${x[i]}`);
    }

    // Manufactured 2D Poisson solution checks the structured direct path against
    // the assembled matrix, independently of the solver's internal residual.
    const checkGrid = 5;
    const checkN = checkGrid * checkGrid;
    const checkMatrix = new WasmSparseMultifrontalSolver(checkN, checkN);
    const checkExact = Float64Array.from({ length: checkN }, (_, i) => Math.sin((i + 1) * 0.3));
    const checkRhs = new Float64Array(checkN);
    for (let yy = 0; yy < checkGrid; yy++) {
      for (let xx = 0; xx < checkGrid; xx++) {
        const i = yy * checkGrid + xx;
        checkMatrix.addEntry(i, i, 4);
        if (xx > 0) checkMatrix.addEntry(i, i - 1, -1);
        if (xx < checkGrid - 1) checkMatrix.addEntry(i, i + 1, -1);
        if (yy > 0) checkMatrix.addEntry(i, i - checkGrid, -1);
        if (yy < checkGrid - 1) checkMatrix.addEntry(i, i + checkGrid, -1);

        let value = 4 * checkExact[i];
        if (xx > 0) value -= checkExact[i - 1];
        if (xx < checkGrid - 1) value -= checkExact[i + 1];
        if (yy > 0) value -= checkExact[i - checkGrid];
        if (yy < checkGrid - 1) value -= checkExact[i + checkGrid];
        checkRhs[i] = value;
      }
    }
    const checkMetrics = checkMatrix.factorize();
    const checkResult = checkMatrix.solve(checkRhs);
    assert.strictEqual(checkMetrics.solverMethod, '2d-poisson-dst1');
    for (let i = 0; i < checkN; i++) {
      assert(Math.abs(checkResult.solution[i] - checkExact[i]) < 1e-10);
    }

    // Even grids exercise the DST symmetry path without a center sample and
    // cross-check the structured result against generic sparse Cholesky.
    const evenGrid = 4;
    const evenN = evenGrid * evenGrid;
    const evenExact = Float64Array.from({ length: evenN }, (_, i) => Math.cos(i * 0.17) - 0.2);
    const evenRhs = new Float64Array(evenN);
    const evenDst = new WasmSparseMultifrontalSolver(evenN, evenN);
    const evenSparse = new WasmSparseMultifrontalSolver(evenN, evenN, { enableStructuredPoissonDirect: false });
    for (let yy = 0; yy < evenGrid; yy++) {
      for (let xx = 0; xx < evenGrid; xx++) {
        const i = yy * evenGrid + xx;
        const entries = [[i, 4]];
        if (xx > 0) entries.push([i - 1, -1]);
        if (xx < evenGrid - 1) entries.push([i + 1, -1]);
        if (yy > 0) entries.push([i - evenGrid, -1]);
        if (yy < evenGrid - 1) entries.push([i + evenGrid, -1]);

        let value = 4 * evenExact[i];
        for (const [column, coefficient] of entries.slice(1)) {
          value += coefficient * evenExact[column];
        }
        evenRhs[i] = value;
        for (const [column, coefficient] of entries) {
          evenDst.addEntry(i, column, coefficient);
          evenSparse.addEntry(i, column, coefficient);
        }
      }
    }
    const evenDstMetrics = evenDst.factorize();
    const evenSparseMetrics = evenSparse.factorize();
    const evenDstResult = evenDst.solve(evenRhs);
    const evenSparseResult = evenSparse.solve(evenRhs);
    assert.strictEqual(evenDstMetrics.solverMethod, '2d-poisson-dst1');
    assert.strictEqual(evenSparseMetrics.solverMethod, 'sparse-cholesky');
    assert(
      evenDstResult.solution.every(
        (value, i) => Math.abs(value - evenExact[i]) < 1e-10 && Math.abs(value - evenSparseResult.solution[i]) < 1e-10
      ),
      'Even-grid DST solution matches the manufactured vector and generic sparse Cholesky'
    );

    const poisson = measureStructuredPoissonBudget();
    assert(
      poisson.relativeResidual < 1e-8,
      `100k-unknown relative residual ${poisson.relativeResidual} must be < 1e-8`
    );
    assert(poisson.independentResidualRms < 1e-8, 'Independent 2D Poisson residual must be below 1e-8');
    assert.strictEqual(poisson.solverMethod, '2d-poisson-dst1');
    assert.strictEqual(poisson.nnzL, null, 'The spectral path must not report sparse Cholesky fill');
    assert(
      poisson.factorizationStorageBytes < poisson.unknowns * 9,
      'DST basis storage must remain linear in the unknown count'
    );
    const coverageMode = process.env.OMNI_COVERAGE_MODE === '1' && typeof process.env.NODE_V8_COVERAGE === 'string';

    const timingSummary = coverageMode
      ? `${poisson.elapsedMs.toFixed(0)} ms under V8 coverage instrumentation (performance budget not scored)`
      : `${(poisson.elapsedMs / 1000).toFixed(2)} s measured (performance budget enforced by npm run test:poisson-budget)`;
    console.log(
      `  ✓ PASSED: 5x5 sparse Cholesky exact; manufactured DST solution exact; ${poisson.unknowns.toLocaleString()}-unknown 2D Poisson DST direct solve: relRes=${poisson.relativeResidual.toExponential(2)}, factor storage=${(poisson.factorizationStorageBytes / (1024 * 1024)).toFixed(2)} MiB, ${timingSummary}`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 4: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Case 5: Experimental serial CPU PCG solve
  // -------------------------------------------------------------
  try {
    process.stdout.write('[CASE 5] Experimental serial CPU PCG with CSR SpMV and Jacobi preconditioning...\n');
    const pcg = new GPUParallelPCGSolver({ maxIterations: 100, tolerance: 1e-7 });
    assert.throws(() => new GPUParallelPCGSolver({ useWebGPU: true }), /does not support the 'useWebGPU' option/);
    assert.throws(() => pcg.solve({ n: 1, rowPtr: [0, 0], colIdx: [], values: [] }, [1]), /finite positive diagonal/);
    const N = 20;
    // Construct 1D Poisson matrix: diag = 2, sub/super = -1
    const A = Array.from({ length: N }, () => new Float64Array(N));
    for (let i = 0; i < N; i++) {
      A[i][i] = 2.0;
      if (i > 0) A[i][i - 1] = -1.0;
      if (i < N - 1) A[i][i + 1] = -1.0;
    }
    const b = new Float64Array(N).fill(1.0);

    const res = pcg.solve(A, b);
    assert.strictEqual(res.converged, true, 'PCG must converge');
    assert(res.residualNorm < 1e-7, 'Residual norm must be < 1e-7');

    // Scale check: 2D Poisson 100x100 (10,000 unknowns) in CSR, cross-checked against the direct solver
    const G2 = 100;
    const N2 = G2 * G2;
    const direct = new WasmSparseMultifrontalSolver(N2, N2, { enableStructuredPoissonDirect: false });
    const rowPtr = new Int32Array(N2 + 1);
    const cols = [];
    const vals = [];
    for (let yy = 0; yy < G2; yy++) {
      for (let xx = 0; xx < G2; xx++) {
        const i = yy * G2 + xx;
        const push = (j, v) => {
          cols.push(j);
          vals.push(v);
          direct.addEntry(i, j, v);
        };
        if (yy > 0) push(i - G2, -1);
        if (xx > 0) push(i - 1, -1);
        push(i, 4);
        if (xx < G2 - 1) push(i + 1, -1);
        if (yy < G2 - 1) push(i + G2, -1);
        rowPtr[i + 1] = cols.length;
      }
    }
    const csr2 = { n: N2, nnz: cols.length, rowPtr, colIdx: Int32Array.from(cols), values: Float64Array.from(vals) };
    const b2 = new Float64Array(N2);
    for (let i = 0; i < N2; i++) b2[i] = Math.sin(i * 0.01) + 1.0;
    const pcgBig = new GPUParallelPCGSolver({ maxIterations: 5000, tolerance: 1e-10 });
    const rBig = pcgBig.solve(csr2, b2);
    assert.strictEqual(rBig.converged, true, `10k-unknown PCG must converge (rel res ${rBig.relativeResidual})`);
    direct.finalizeCSR();
    const directMetrics = direct.factorize();
    assert.strictEqual(directMetrics.solverMethod, 'sparse-cholesky');
    const dSol = direct.solve(b2).solution;
    let maxDiff = 0;
    for (let i = 0; i < N2; i++) maxDiff = Math.max(maxDiff, Math.abs(dSol[i] - rBig.solution[i]));
    assert(maxDiff < 1e-6, `PCG vs direct solution mismatch ${maxDiff}`);
    assert.strictEqual(rBig.gpuSpeedupVerified, false, 'No unmeasured GPU speedup may be claimed');

    console.log(
      `  ✓ PASSED: PCG 20x20 in ${res.iterations} iterations; ${N2.toLocaleString()}-unknown CSR in ${rBig.iterations} iterations (${rBig.elapsedMs.toFixed(0)} ms, serial CPU-JS, estimated ${rBig.estimatedThroughputGFlops} GFlop/s), max|PCG-direct| = ${maxDiff.toExponential(2)}; GPU speedup not verified`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED CASE 5: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 6: Explicit Dynamics Crash Solver (Taylor Bar Impact)
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 6] Explicit Dynamics Crash & Central Difference Time Integration...\n');
    const crash = new ExplicitDynamicsCrashSolver();
    const dtCrit = crash.calculateCriticalTimeStep(0.005, 200e9, 7850); // 5mm steel element
    assert(dtCrit > 0 && dtCrit < 1e-5, 'Critical time step must be positive and bounded by CFL');

    // Simulate Taylor bar impact: steel bar at 200 m/s impacting rigid wall
    const impact = crash.simulateTaylorBarImpact({
      length: 0.05,
      radius: 0.005,
      velocity: 200.0,
      yieldStrength: 400e6,
      density: 7850,
      youngsModulus: 200e9,
      elements: 10
    });

    assert(impact.finalLength < 0.05, 'Taylor bar must undergo plastic shortening');
    assert(impact.mushroomRadius > 0.005, 'Taylor bar must mushroom at impact interface');
    assert(impact.totalPlasticEnergyJ > 0, 'Plastic dissipation energy must be positive');

    console.log(
      `  ✓ PASSED: Taylor bar impact shortened from 50.0mm to ${(impact.finalLength * 1000).toFixed(2)}mm, mushroom radius = ${(impact.mushroomRadius * 1000).toFixed(2)}mm`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 6: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 7: Hyperelastic Mooney-Rivlin & Ogden Constitutive Law
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 7] Hyperelastic Mooney-Rivlin & Ogden Rubber Formulations...\n');
    // Rubber coupon: C10 = 0.293 MPa, C01 = 0.177 MPa
    const rubber = new HyperelasticMaterialModel({
      model: 'mooney_rivlin_2',
      C10: 0.293e6,
      C01: 0.177e6
    });

    // Uniaxial tension at stretch lambda = 2.0 (100% strain)
    const curve = rubber.generateUniaxialTensionCurve(3.0, 20);
    const midPoint = curve.find((p) => Math.abs(p.stretch - 2.0) < 0.1);
    assert(midPoint && midPoint.nominalStressMpa > 0.5, 'Mooney-Rivlin nominal stress must be positive and realistic');

    console.log(
      `  ✓ PASSED: Evaluated Mooney-Rivlin uniaxial curve up to stretch 3.0 (Nominal Stress @ lambda=2: ${midPoint.nominalStressMpa.toFixed(2)} MPa)`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 7: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 8: ASTM E1049-85 Rainflow Cycle Counting & Fatigue Life
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 8] ASTM E1049 Rainflow Cycle Counting & Miner Cumulative Damage...\n');
    const fatigue = new FatigueLifeAnalyzer();
    const stressHistory = [0, 100, -50, 150, -100, 200, 0];
    const cycles = fatigue.rainflowCounting(stressHistory);
    assert(cycles.length >= 2, 'Rainflow algorithm must extract closed hysteresis cycles');

    const damage = fatigue.calculateMinerDamage(cycles, 1000.0, -0.1, 450.0);
    assert(damage.cumulativeDamageD > 0 && damage.cumulativeDamageD < 1.0, 'Miner damage must accumulate accurately');

    console.log(
      `  ✓ PASSED: Rainflow extracted ${cycles.length} cycles, Miner cumulative damage D = ${damage.cumulativeDamageD.toExponential(3)}`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 8: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 9: VOF Free-Surface Dam Break Two-Phase Tracking
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 9] Volume of Fluid (VOF) Free-Surface Tracking & PLIC Reconstruction...\n');
    const vof = new VOFMultiphaseSolver({ nx: 20, ny: 10 });
    const damBreak = vof.simulateDamBreak(0.1); // 100 ms simulation
    assert(damBreak.wavefrontPositionX > 0.4, 'Dam break wave front must propagate forward');
    assert(damBreak.massConservationErrorPercent < 0.01, 'VOF mass conservation error must be < 0.01%');

    console.log(
      `  ✓ PASSED: Dam break wave front reached x = ${damBreak.wavefrontPositionX.toFixed(3)}m, mass conservation error = ${damBreak.massConservationErrorPercent.toFixed(4)}%`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 9: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 10: Sliding Mesh Turbomachinery & Pump Head (Euler)
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 10] Sliding Mesh Turbomachinery & MRF Coriolis Frame...\n');
    const turbo = new SlidingMeshTurbomachinery();
    const coriolis = turbo.calculateMRFAcceleration([1, 0, 0], [0, 0, 100], [0, 2, 0]);
    assert(coriolis.magnitude > 0, 'Coriolis acceleration must be computed');

    // Centrifugal pump: r2 = 0.15m, b2 = 0.02m, beta2 = 30 deg, 1750 RPM
    const pumpCurve = turbo.evaluateCentrifugalPumpCurve(0.15, 0.02, 30.0, 1750.0);
    assert(pumpCurve.shutoffHeadM > 20.0, 'Shutoff head must match Euler head at Q=0');
    assert(pumpCurve.bepFlowM3H > 10.0, 'BEP flow must be positive');

    console.log(
      `  ✓ PASSED: Pump Euler shutoff head = ${pumpCurve.shutoffHeadM.toFixed(2)}m, BEP flow = ${pumpCurve.bepFlowM3H.toFixed(1)} m³/h`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 10: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 11: Composite Current Source (CCS) Nanometer Timing
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 11] Composite Current Source (CCS) Nanometer Timing Engine...\n');
    const ccs = new CCSTimingModel();
    // 7nm FinFET inverter driving 5 fF load
    const sim = ccs.simulateDriverOutput(5e-15, 0.7);
    assert(sim.delaySeconds > 0 && sim.delaySeconds < 1e-9, 'CCS stage delay must be sub-nanosecond');
    assert(sim.slewSeconds > 0, 'CCS transition slew must be positive');

    console.log(
      `  ✓ PASSED: 7nm Inverter CCS delay = ${(sim.delaySeconds * 1e12).toFixed(2)} ps, slew = ${(sim.slewSeconds * 1e12).toFixed(2)} ps`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 11: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Case 12: Experimental caller-supplied crosstalk arithmetic
  // -------------------------------------------------------------
  try {
    process.stdout.write('[CASE 12] Experimental caller-supplied crosstalk estimate...\n');
    const si = new SignalIntegrityCrosstalk();
    const inputs = SYNTHETIC_CROSSTALK_INPUTS;
    const glitch = si.calculateGlitchAmplitude(inputs);

    assert(glitch.vPeakVolts > 0 && glitch.vPeakVolts < 0.75, 'Glitch peak must be positive and bounded');
    assert.strictEqual(glitch.validationLevel, 'experimental');
    assert.strictEqual(glitch.dataStatus, 'caller-supplied-unverified');
    assert.match(glitch.pulseWidthSemantics, /caller-supplied factor estimate/);
    assert(
      typeof glitch.belowSuppliedNoiseThreshold === 'boolean',
      'The supplied-threshold screen must return a boolean'
    );
    assert.match(glitch.thresholdComparison, /^(below|above)-supplied-threshold$/);
    assert.throws(
      () => si.calculateGlitchAmplitude({ ...inputs, noiseMarginThresholdV: undefined }),
      /noiseMarginThresholdV/
    );
    assert.throws(
      () => si.calculateGlitchAmplitude({ vdd: 0.75, noiseMarginThresholdV: 0.15 }),
      /aggressorSlewRateVPerSecond/
    );
    assert.strictEqual(glitch.fwhmSeconds, null, 'The lumped estimate must not claim a waveform-derived FWHM');
    const withoutWidthFactor = si.calculateGlitchAmplitude({
      ...inputs,
      pulseWidthTimeConstantFactor: undefined
    });
    assert.strictEqual(withoutWidthFactor.pulseWidthEstimateSeconds, null);

    console.log(
      `  ✓ PASSED: Synthetic inputs produced ${(glitch.vPeakVolts * 1000).toFixed(
        1
      )} mV and a ${glitch.pulseWidthEstimatePs.toFixed(1)} ps caller-factor width estimate; supplied-threshold comparison: ${glitch.thresholdComparison}`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED CASE 12: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Case 13: Experimental synthetic lumped PDN calculation
  // -------------------------------------------------------------
  try {
    process.stdout.write('[CASE 13] Synthetic caller-supplied lumped PDN arithmetic...\n');
    const pdn = createSyntheticPdnAnalyzer({ vdd: 1.0 });
    const mesh = createSyntheticPdnMesh(pdn, 6, 6);
    const pads = [0, 35];
    const sinks = [
      { nodeId: 14, current: 0.005 },
      { nodeId: 21, current: 0.005 }
    ];

    const irResult = pdn.solveStaticIRDrop(mesh, pads, sinks);
    assert(Number.isFinite(irResult.minVoltage), 'Synthetic lumped result must be finite');
    assert.strictEqual(irResult.validationLevel, 'experimental');
    assert.strictEqual(irResult.dataStatus, 'caller-supplied-unverified');
    assert.strictEqual(typeof irResult.belowSuppliedThreshold, 'boolean');

    console.log(
      `  ✓ PASSED: Synthetic formula returned ${irResult.dropPercent.toFixed(4)}% of supplied VDD; threshold comparison: ${irResult.thresholdComparison}`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 13: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 14: SEMI P39 OASIS Binary Stream Serialization (> 70% compression)
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 14] SEMI P39 OASIS Binary Layout Serialization & Compression...\n');
    const oasis = new OasisStreamEngine();
    const testLayout = {
      name: 'TOP_CHIP',
      cells: [
        {
          name: 'NAND2_X1',
          rectangles: Array.from({ length: 50 }, (_, i) => ({
            layer: 1,
            datatype: 0,
            width: 100,
            height: 200,
            x: i * 120,
            y: 0
          })),
          placements: []
        }
      ]
    };

    const comp = oasis.evaluateCompressionRatio(testLayout);
    assert(comp.oasisSizeBytes > 0, 'OASIS stream must be serialized');
    assert(comp.reductionPercent >= 70.0, `OASIS reduction ${comp.reductionPercent}% must be >= 70%`);

    // Verify round-trip deserialization
    const binary = oasis.serialize(testLayout);
    const parsed = oasis.deserialize(binary);
    assert.strictEqual(parsed.cells[0].name, 'NAND2_X1', 'Cell name must match roundtrip');
    assert.strictEqual(parsed.cells[0].rectangles.length, 50, 'All 50 rectangles must be deserialized');

    console.log(
      `  ✓ PASSED: Serialized 50 shapes into ${comp.oasisSizeBytes} bytes OASIS stream (${comp.reductionPercent.toFixed(1)}% reduction vs GDSII)`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 14: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Experimental smoke check 15: explicit-input DLS optical optimizer
  // -------------------------------------------------------------
  try {
    process.stdout.write('[SM 15] Experimental DLS optimizer with caller-supplied system and targets...\n');
    const dls = new DampedLeastSquaresOptimizer({
      initialDamping: 0.001,
      minimumDamping: 1e-7,
      maximumDamping: 1e5,
      dampingReductionFactor: 2,
      dampingIncreaseFactor: 4,
      maxIterations: 10,
      tolerance: 1e-7,
      finiteDiffStep: 1e-5
    });
    const lensSystem = {
      initialRefractiveIndex: 1.0,
      metricSampling: {
        entrancePupilRadiusMm: 10.0,
        paraxialRayHeightMm: 0.1,
        zonalRayFraction: 0.7071067811865476,
        chiefRayAngleRad: 0.05
      },
      surfaces: [
        { radius: 50.0, thickness: 5.0, refractiveIndex: 1.5168 },
        { radius: -50.0, thickness: 45.0, refractiveIndex: 1.0 },
        { curvature: 0.0, thickness: 0.0, refractiveIndex: 1.0 }
      ]
    };

    const vars = [
      { surfaceIndex: 0, param: 'radius', min: 20.0, max: 100.0 },
      { surfaceIndex: 1, param: 'radius', min: -100.0, max: -20.0 }
    ];

    const operands = [
      { type: 'PARAXIAL_FOCAL_LENGTH', targetMm: 50.0, weight: 1.0 },
      { type: 'TERMINAL_RAY_SPREAD', targetMm: 0.0, weight: 0.01 }
    ];
    const optResult = dls.optimize(lensSystem, vars, operands);
    assert(optResult.finalMerit <= optResult.initialMerit, 'Optimization must reduce or preserve merit function');
    assert(optResult.improvementPercent >= 0.0, 'Improvement must be non-negative');
    assert.strictEqual(optResult.validationLevel, 'experimental');
    assert.throws(() => new DampedLeastSquaresOptimizer().optimize(lensSystem, vars, operands), /option/);

    console.log(
      `  ✓ PASSED: Experimental algorithm smoke check; merit ${optResult.initialMerit.toPrecision(4)} → ${optResult.finalMerit.toPrecision(4)}. No optical correlation is implied.`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 15: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 16: Optical Tolerancing Yield Compensator
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 16] Optical Manufacturing Tolerancing & Compensator Yield...\n');
    const tolEngine = new TolerancingYieldCompensator({ trials: 50 });
    const nominalLens = {
      surfaces: [
        { radius: 45.0, thickness: 6.0, refractiveIndex: 1.5168 },
        { radius: -75.0, thickness: 52.88, refractiveIndex: 1.0 },
        { radius: 0.0, thickness: 0.0, refractiveIndex: 1.0 }
      ]
    };

    const tolerances = [
      { surfaceIndex: 0, type: 'RADIUS', tolerance: 0.2 },
      { surfaceIndex: 0, type: 'THICKNESS', tolerance: 0.05 }
    ];

    const yieldResult = tolEngine.runMonteCarloYield(nominalLens, tolerances, { targetRmsSpotUm: 150.0 });
    assert(yieldResult.samplePassPercent >= 70.0, 'Synthetic sample pass fraction should meet the example threshold');
    assert.strictEqual(yieldResult.validationLevel, 'experimental');
    assert.match(yieldResult.interpretation, /not production yield/);
    assert(!Object.hasOwn(yieldResult, 'yieldPercent'));

    console.log(
      `  ✓ PASSED: Experimental 50-trial tolerance sweep had ${yieldResult.samplePassPercent.toFixed(1)}% of synthetic samples below the supplied spot-radius threshold; not a production-yield estimate`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 16: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 17: Experimental Optical Glass Example (Sellmeier Dispersion)
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 17] Experimental Optical Glass Example & Sellmeier Dispersion...\n');
    const cat = new OpticalGlassCatalog(opticalExamples.opticalGlassExamples);
    assert(cat.catalogSize === 15, `Expected 15 fixed examples, got ${cat.catalogSize}`);

    const nbk7Props = cat.getOpticalProperties('N-BK7');
    assert.strictEqual(nbk7Props.dataStatus, 'experimental');
    // SCHOTT N-BK7 official datasheet values; the local record's redistribution status is not reviewed.
    assert(Math.abs(nbk7Props.nd - 1.5168) < 1e-4, `N-BK7 nd ${nbk7Props.nd} must match 1.51680`);
    assert(Math.abs(nbk7Props.Abbe_Vd - 64.17) < 0.2, `N-BK7 Vd ${nbk7Props.Abbe_Vd} must match 64.17`);

    console.log(
      `  ✓ PASSED: Experimental N-BK7 calculation (nd = ${nbk7Props.nd.toFixed(5)}, Vd = ${nbk7Props.Abbe_Vd.toFixed(2)})`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 17: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 18: Experimental Stateflow behavior and C code-generation example
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 18] Experimental Stateflow FSM and C code-generation example...\n');
    const fsm = new StateflowFSMEngine({ name: 'FlightModeController' });
    fsm.addState({ id: 'OFF', isInitial: true }).addState({ id: 'STANDBY' }).addState({ id: 'ENGAGED' });

    fsm
      .addTransition({ source: 'OFF', target: 'STANDBY', event: 'POWER_ON' })
      .addTransition({ source: 'STANDBY', target: 'ENGAGED', afterSeconds: 0.1 });

    fsm.initialize();
    fsm.step(0.01, 'POWER_ON');
    assert(fsm.activeStates.has('STANDBY'), 'Should transition to STANDBY on event');

    // Step 0.15s to trigger temporal after(0.1s)
    fsm.step(0.15);
    assert(fsm.activeStates.has('ENGAGED'), 'Should transition to ENGAGED after 0.1s');

    const code = fsm.generateMisraCCode();
    assert(code.header.includes('FlightModeController_State_t'), 'Header must contain typedef');
    assert(code.source.includes('switch (inst->currentState)'), 'Source must contain switch');

    console.log(
      `  ✓ PASSED: Stateflow example completed temporal transitions and emitted C source (${code.source.length} chars)`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 18: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 19: Simscape Multi-Domain Physical Hydraulic Circuit
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 19] Simscape Hydraulic Network & Double-Acting Cylinder...\n');
    const simscape = new SimscapeDomainLibrary();
    const eha = simscape.simulateElectroHydraulicLoop({
      supplyPressure: 21e6, // 210 bar
      targetPosition: 0.08, // 80 mm
      duration: 0.2
    });

    assert(eha.finalPosition > 0.05, 'Hydraulic cylinder must stroke forward');
    assert(eha.history.length > 0, 'Simulation history must be generated');

    console.log(
      `  ✓ PASSED: Hydraulic cylinder stroking to ${(eha.finalPosition * 1000).toFixed(1)}mm under 210 bar supply pressure`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 19: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 20: Dynamic Flowsheet Solver & Separator Blowdown
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 20] Dynamic Flowsheet & API 521 Separator Emergency Blowdown...\n');
    const plant = new DynamicFlowsheetSolver({ dt: 0.1 });
    const blowdown = plant.simulateSeparatorBlowdown(
      {
        totalVolume: 15.0,
        initialPressure: 50e5, // 50 bar
        initialLiquidVolume: 4.0,
        reliefOrificeDiameterMm: 50.0
      },
      60.0
    );

    assert(blowdown.finalPressureBar < blowdown.initialPressureBar, 'Pressure must decrease');
    assert(blowdown.finalPressureBar < 15.0, 'Emergency blowdown must depressurize vessel');

    console.log(
      `  ✓ PASSED: Separator depressurized from ${blowdown.initialPressureBar.toFixed(1)} bar to ${blowdown.finalPressureBar.toFixed(1)} bar within 60s`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 20: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 21: Electrolyte NRTL (eNRTL) Acid Gas Treating (CO2/MEA)
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 21] Electrolyte NRTL (eNRTL) Ionic Thermodynamics & CO2 Capture...\n');
    const enrtl = new ElectrolyteNRTLModel({ temperatureK: 313.15, meaMassFraction: 0.3 });
    const vle = enrtl.calculateCO2VLE(0.35); // loading alpha = 0.35
    assert(
      vle.pCO2_kPa > 0.1 && vle.pCO2_kPa < 5.0,
      `P_CO2 ${vle.pCO2_kPa} kPa must match experimental range (~0.75 kPa)`
    );

    const cap = enrtl.evaluateCaptureCapacity(0.45, 0.2, 50000.0);
    assert(cap.co2CapturedTonsPerDay > 10.0, 'Net CO2 captured must be realistic');

    console.log(
      `  ✓ PASSED: eNRTL evaluated CO2 VLE at alpha=0.35 (P_CO2 = ${vle.pCO2_kPa.toFixed(3)} kPa), capture = ${cap.co2CapturedTonsPerDay.toFixed(1)} tons/day`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 21: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 22: Experimental caller-supplied CAD centroid comparison
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 22] Experimental CAD Centroid Comparison & Face Categorization...\n');
    const diff = new GitCADVisualDiffEngine({ toleranceMm: 0.01, modificationThresholdMm: 5 });
    const revA = {
      commitId: 'revA_hash',
      units: { length: 'mm', volume: 'mm3' },
      volumeMm3: 10000.0,
      faces: [
        { id: 'f1', centroidMm: { x: 0, y: 0, z: 0 } },
        { id: 'f2_wall', centroidMm: { x: 10, y: 0, z: 0 } },
        { id: 'f3_old', centroidMm: { x: 50, y: 50, z: 50 } }
      ]
    };
    const revB = {
      commitId: 'revB_hash',
      units: { length: 'mm', volume: 'mm3' },
      volumeMm3: 8500.0,
      faces: [
        { id: 'f1', centroidMm: { x: 0, y: 0, z: 0 } },
        { id: 'f2_wall', centroidMm: { x: 8.5, y: 0, z: 0 } },
        { id: 'f4_new', centroidMm: { x: 100, y: 100, z: 100 } }
      ]
    };

    const res = diff.compareRevisions(revA, revB);
    assert.strictEqual(res.summary.addedCount, 1, '1 added face');
    assert.strictEqual(res.summary.removedCount, 1, '1 removed face');
    assert.strictEqual(res.summary.modifiedCount, 1, '1 modified face');
    assert.strictEqual(res.summary.unchangedCount, 1, '1 unchanged face');
    assert(
      Math.abs(res.maxCentroidDisplacementMm - 1.5) < 0.05,
      `Detected 1.5mm maximum centroid displacement, got ${res.maxCentroidDisplacementMm}`
    );
    assert.strictEqual(res.maxThicknessReductionMm, null);
    assert.strictEqual(res.validationLevel, 'experimental');

    console.log(
      `  ✓ PASSED: Identified 1 added (green), 1 removed (red), 1 modified (yellow), and 1.5mm centroid displacement`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 22: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 23: Hierarchical Engineering Bill of Materials (eBOM)
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 23] Hierarchical eBOM Roll-Up & Single-Level Consolidation...\n');
    const bom = new EngineeringBOMManager();
    bom.setRootAssembly({
      partNumber: 'ASM-DRONE-001',
      name: 'Hexacopter Airframe Assembly',
      quantity: 1,
      unitCostUsd: 150.0,
      unitMassKg: 1.2,
      children: [
        {
          partNumber: 'SUB-ARM-01',
          name: 'Carbon Rotor Arm',
          quantity: 6,
          unitCostUsd: 25.0,
          unitMassKg: 0.15,
          children: [
            {
              partNumber: 'FAST-M3-10',
              name: 'M3x10 Titanium Screw',
              quantity: 4,
              unitCostUsd: 0.5,
              unitMassKg: 0.002
            }
          ]
        }
      ]
    });

    const rolled = bom.computeRollUp();
    assert(rolled.rolledUpMassKg > 2.0, 'Total rolled up mass should account for 6 arms');
    assert(rolled.rolledUpCostUsd > 300.0, 'Total rolled up cost should account for 6 arms + screws');

    const flat = bom.generateFlattenedBOM();
    const screwEntry = flat.find((p) => p.partNumber === 'FAST-M3-10');
    assert(screwEntry && screwEntry.totalQuantity === 24, 'Fastener quantity must consolidate to 6 x 4 = 24');

    console.log(
      `  ✓ PASSED: eBOM rolled up assembly (Mass: ${rolled.rolledUpMassKg.toFixed(2)} kg, Cost: $${rolled.rolledUpCostUsd.toFixed(2)}), Consolidated screws: ${screwEntry.totalQuantity}`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 23: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Experimental diagnostic test helper; no tool qualification claim.
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 24] Experimental test-helper diagnostic...\n');
    const tqk = new ToolQualificationKit({ targetSafetyStandard: 'DO-178C_DAL_A' });
    tqk.registerTestCase({
      id: 'TC_CAE_001',
      description: 'Von Mises Stress Verification against Timoshenko Thick Cylinder',
      execute: () => ({ actual: 276.4, expected: 276.4, passes: true })
    });
    tqk.registerTestCase({
      id: 'TC_EDA_001',
      description: 'Clock Tree Zero Skew Verification',
      execute: () => ({ actual: 0.0, expected: 0.0, passes: true })
    });

    const rep = tqk.executeQualificationSuite();
    assert.strictEqual(rep.dataStatus, 'experimental');
    assert.strictEqual(rep.status, 'diagnostic-only');
    assert.strictEqual(rep.passRatePercent, 100.0, 'Pass rate must be 100%');

    const mdReport = tqk.generateComplianceReport();
    assert(mdReport.includes('not tool qualification'), 'Report must deny qualification status');

    console.log(`  ✓ PASSED: Executed ${rep.totalTests} experimental diagnostic test vectors`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 24: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 25: Experimental stress-line screening helper
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 25] Experimental stress-line screen example (Pm, Pb, Q)...\n');
    const asme = new ASMESectionVIIIDiv2Analyzer({
      allowableStressS: 138.0,
      allowableStressSource: 'experimental smoke fixture; not an approved material allowable'
    });
    // Discrete stress points through 25mm cylinder wall
    const sclPoints = [
      { x: -12.5, stressMpa: 110.0 }, // Inside surface
      { x: -6.25, stressMpa: 98.0 },
      { x: 0.0, stressMpa: 90.0 }, // Mid-plane
      { x: 6.25, stressMpa: 84.0 },
      { x: 12.5, stressMpa: 80.0 } // Outside surface
    ];

    const sclRes = asme.linearizeStressClassificationLine(sclPoints, 25.0, false);
    assert.strictEqual(sclRes.status, 'screening-only');
    assert.strictEqual(typeof sclRes.screening.withinAllSuppliedLimits, 'boolean');
    assert.strictEqual(sclRes.screening.withinSuppliedPmLimit, true);
    assert.strictEqual(sclRes.screening.withinSuppliedPmPbLimit, true);

    console.log(
      `  ✓ PASSED: Experimental linearization example returned Pm=${sclRes.membraneStressPm.toFixed(2)} MPa and Pb=${sclRes.bendingStressPb.toFixed(2)} MPa; its values are below the supplied screening limits (not a code assessment)`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 25: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 26: High-Temperature Non-Linear Creep (Norton-Bailey)
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 26] Non-Linear Creep Strain Rate (Norton-Bailey Power Law)...\n');
    // Secondary creep: d(epsilon)/dt = A * sigma^n
    // For 316H stainless steel at 650°C: A ~ 1e-18, n ~ 5.0
    const A_creep = 1.0e-18;
    const n_creep = 5.0;
    const sigmaMpa = 120.0;
    const creepRatePerHour = A_creep * Math.pow(sigmaMpa, n_creep);
    const creep1000h = creepRatePerHour * 1000.0;

    assert(creepRatePerHour > 0 && creep1000h < 0.05, 'Creep strain must be positive and bounded');
    console.log(
      `  ✓ PASSED: Norton creep strain rate @ 120 MPa: ${creepRatePerHour.toExponential(3)} /hr, 1000h accumulation = ${(creep1000h * 100).toFixed(4)}%`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 26: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Case 27: Caller-parameterized Black formula smoke check
  // -------------------------------------------------------------
  try {
    process.stdout.write('[CASE 27] Caller-parameterized Black formula smoke check...\n');
    const pdn = new PowerGridIRDropAnalyzer({});
    const em = pdn.evaluateBlacksEM(5.0e5, 105.0, SYNTHETIC_BLACKS_MODEL);
    assert(Number.isFinite(em.formulaEstimateHours) && em.formulaEstimateHours > 0);
    assert.strictEqual(em.dataStatus, 'caller-supplied-unverified');
    assert(!Object.hasOwn(em, 'status'), 'The formula does not assign a reliability verdict');

    console.log(
      `  ✓ PASSED: Synthetic coefficients returned an unverified formula estimate of ${em.formulaEstimateHours.toExponential(3)} hours`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 27: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 28: Multi-Stream Pinch Analysis & Heat Exchanger Network
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 28] Pinch Analysis & Minimum Utility Energy Recovery Target...\n');
    // Hot stream: 200°C -> 80°C, CP = 2.0 kW/K (Heat = 240 kW)
    // Cold stream: 40°C -> 160°C, CP = 3.0 kW/K (Heat = 360 kW)
    // DeltaT_min = 10 K -> Maximum heat recovery = 240 kW, Hot utility needed = 120 kW
    const hotHeat = 2.0 * (200 - 80);
    const coldHeat = 3.0 * (160 - 40);
    const maxRecovery = Math.min(hotHeat, coldHeat);
    const hotUtility = coldHeat - maxRecovery;

    assert(maxRecovery === 240.0, 'Max heat recovery should be 240 kW');
    assert(hotUtility === 120.0, 'Hot utility required should be 120 kW');

    console.log(
      `  ✓ PASSED: Pinch synthesis: Max process recovery = ${maxRecovery} kW, Minimum hot utility = ${hotUtility} kW`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 28: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 29: Multi-Physics Electromechanical & Optical Co-Simulation
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 29] Multi-Physics Electromechanical Actuator & Optical Co-Sim...\n');
    // Co-simulate: Hydraulic piston moves lens element -> changes EFL and optical focus
    const simscape = new SimscapeDomainLibrary();
    const dls = new DampedLeastSquaresOptimizer();

    const piston = SimscapeDomainLibrary.evaluateHydraulicCylinder(
      { pistonAreaA: 1e-3, pistonAreaB: 1e-3, mass: 2.0, damping: 10.0 },
      10e6,
      2e6,
      0.05
    );

    const deltaFocusMm = piston.acceleration * 0.001; // small displacement in 1ms
    const optical = dls.traceMeridionalRay(
      {
        initialRefractiveIndex: 1.0,
        surfaces: [
          { radius: 50.0, thickness: 5.0 + deltaFocusMm, refractiveIndex: 1.5168 },
          { radius: -50.0, thickness: 45.0, refractiveIndex: 1.0 },
          { curvature: 0.0, thickness: 0.0, refractiveIndex: 1.0 }
        ]
      },
      10.0,
      0.0
    );

    assert(optical.finalY !== undefined, 'Optical ray must trace through displaced lens');
    assert(piston.fHydro > 0, 'Hydraulic force must be positive');

    console.log(
      `  ✓ PASSED: Co-simulated 8.0 kN hydraulic actuator coupled to optical element (Focal spot Y: ${optical.finalY.toFixed(4)}mm)`
    );
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 29: ${err.message}`);
  }

  // -------------------------------------------------------------
  // Benchmark 30: End-to-End Headless Production Integration
  // -------------------------------------------------------------
  try {
    process.stdout.write('[BM 30] End-to-end legacy module wiring smoke check...\n');
    // Verify all module classes are instantiated and export correctly
    assert(typeof WasmSparseMultifrontalSolver === 'function');
    assert(typeof GPUParallelPCGSolver === 'function');
    assert(typeof VariationalConstraintSolver === 'function');
    assert(typeof TopologicalHealingEngine === 'function');
    assert(typeof PersistentNamingManager === 'function');
    assert(typeof ExplicitDynamicsCrashSolver === 'function');
    assert(typeof HyperelasticMaterialModel === 'function');
    assert(typeof FatigueLifeAnalyzer === 'function');
    assert(typeof VOFMultiphaseSolver === 'function');
    assert(typeof SlidingMeshTurbomachinery === 'function');
    assert(typeof CCSTimingModel === 'function');
    assert(typeof SignalIntegrityCrosstalk === 'function');
    assert(typeof PowerGridIRDropAnalyzer === 'function');
    assert(typeof OasisStreamEngine === 'function');
    assert(typeof DampedLeastSquaresOptimizer === 'function');
    assert(typeof TolerancingYieldCompensator === 'function');
    assert(typeof OpticalGlassCatalog === 'function');
    assert(typeof StateflowFSMEngine === 'function');
    assert(typeof SimscapeDomainLibrary === 'function');
    assert(typeof DynamicFlowsheetSolver === 'function');
    assert(typeof ElectrolyteNRTLModel === 'function');
    assert(typeof WebGPUCFDKernel === 'function');
    assert(typeof SFunctionPluginHost === 'function');
    assert(typeof PetroleumAssayCharacterizer === 'function');
    assert(typeof GitCADVisualDiffEngine === 'function');
    assert(typeof EngineeringBOMManager === 'function');
    assert(typeof ToolQualificationKit === 'function');
    assert(typeof ASMESectionVIIIDiv2Analyzer === 'function');

    // Functional sanity tests for the 3 new gap matrix engines
    const cfd = new WebGPUCFDKernel({ nx: 16, ny: 16, nz: 8 });
    const div = new Float32Array(16 * 16 * 8);
    div[8 + 8 * 16 + 4 * 256] = 10.0;
    const cfdRes = cfd.solvePoissonCPU(div, 0.001);
    assert(cfdRes.iterations > 0, 'CFD Kernel must perform Poisson relaxation');

    const sfunc = new SFunctionPluginHost({ name: 'IntegratorBlock' });
    sfunc.registerDefinition({
      mdlInitializeSizes: (ss) => {
        ss.numContStates = 1;
        ss.numInputs = 1;
        ss.numOutputs = 1;
      },
      mdlDerivatives: (ss, t, u) => {
        u.derivatives[0] = u.inputs[0];
      },
      mdlOutputs: (ss, t, u) => {
        u.outputs[0] = u.continuousStates[0];
      }
    });
    sfunc.initialize();
    sfunc.setInputs([5.0]);
    sfunc.stepContinuousRK4(0.0, 0.1);
    const sOut = sfunc.evaluateOutputs(0.1);
    assert(Math.abs(sOut[0] - 0.5) < 1e-6, `S-Function RK4 integration error: ${sOut[0]}`);

    const assay = new PetroleumAssayCharacterizer({ apiGravity: 34.0 });
    const assayRes = assay.characterize();
    assert(assayRes.pseudoComponents.length >= 4, 'Petroleum assay must split into cuts');
    assert(assayRes.watsonKw > 10.0, 'Watson Kw must be physical');

    console.log(`  ✓ PASSED: Legacy module fixtures executed without assertion errors; this is not release validation`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAILED BM 30: ${err.message}`);
  }

  console.log('\n================================================================');
  console.log(`  SUMMARY: ${passed} / ${total} experimental legacy smoke assertions passed`);
  console.log('================================================================\n');

  return { passed, total, allPassed: passed === total };
}

if (require.main === module) {
  const result = runGoldRegulatoryBenchmarks3();
  process.exit(result.allPassed ? 0 : 1);
}

module.exports = { runGoldRegulatoryBenchmarks3 };
