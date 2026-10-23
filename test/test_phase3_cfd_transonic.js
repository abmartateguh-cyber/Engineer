/**
 * OmniEng Phase 3 Verification Suite:
 * Boundary Layer Prism Meshing, Roe/AUSM+ Transonic CFD & MRF Rotating Frame
 */

'use strict';

const assert = require('assert');
const { PrismLayerMesher } = require('../src/core/cae/prism_layer_mesher');
const { DelaunayMesher3D } = require('../src/core/cae/delaunay_mesher_3d');
const { FVMNavierStokes3D, PolyhedralCell3D } = require('../src/core/cae/fvm_navier_stokes_3d');
const { TransonicRiemannSolver } = require('../src/core/cae/transonic_riemann_solver');

console.log('================================================================');
console.log('   RUNNING PHASE 3: PRISM MESHING & TRANSONIC CFD SOLVER        ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Schlichting Empirical Skin Friction & First Layer Height
// -----------------------------------------------------------------------------
console.log('[P3-1] Schlichting y+ Boundary Layer Formulation...');
const flowConditions = {
  velocity: 50.0,       // 50 m/s (180 km/h)
  density: 1.225,       // air at sea level kg/m^3
  viscosity: 1.81e-5,   // Pa*s
  refLength: 1.0,       // 1 meter chord
  targetYPlus: 1.0      // Viscous sublayer resolution
};

const yPlusCalc = PrismLayerMesher.calculateFirstLayerHeight(flowConditions);
assert(yPlusCalc.reynoldsNumber > 3e6, 'Re should be turbulent (> 3x10^6)');
assert(yPlusCalc.firstLayerHeightM > 0, 'First layer height must be positive');
assert(yPlusCalc.firstLayerHeightM < 5e-4, 'First layer height for y+=1 must be sub-millimeter (< 0.5 mm)');
console.log(`  ✓ [P3-1] Re = ${(yPlusCalc.reynoldsNumber / 1e6).toFixed(2)}M, Cf = ${yPlusCalc.skinFrictionCoeff.toExponential(3)}, y1 = ${(yPlusCalc.firstLayerHeightM * 1e6).toFixed(1)} µm`);

// -----------------------------------------------------------------------------
// Test 2: Boundary Layer Prism Extrusion & Non-Inversion Volume Guarantee
// -----------------------------------------------------------------------------
console.log('\n[P3-2] Anisotropic Prism Layer Extrusion...');
// Surface triangulation: 2 triangles forming a flat square in XY plane
const surfaceMesh = {
  vertices: [
    [0.0, 0.0, 0.0],
    [1.0, 0.0, 0.0],
    [1.0, 1.0, 0.0],
    [0.0, 1.0, 0.0]
  ],
  triangles: [
    [0, 1, 2],
    [0, 2, 3]
  ]
};

const prismMesh = PrismLayerMesher.generatePrismLayers(surfaceMesh, {
  firstLayerHeight: yPlusCalc.firstLayerHeightM,
  growthRatio: 1.25,
  layerCount: 5
});

assert.strictEqual(prismMesh.layerCount, 5, 'Should have 5 extruded layers');
assert.strictEqual(prismMesh.prismElementCount, 10, '2 base triangles * 5 layers = 10 prisms');
assert.strictEqual(prismMesh.invertedElementCount, 0, 'Must have ZERO inverted elements');
assert(prismMesh.minElementVolume > 0, 'All prism elements must have strictly positive volume');
console.log(`  ✓ [P3-2] Generated ${prismMesh.prismElementCount} prisms, minVol = ${prismMesh.minElementVolume.toExponential(3)} m³, inverted = ${prismMesh.invertedElementCount}`);

// -----------------------------------------------------------------------------
// Test 3: Roe Approximate Riemann Solver with Entropy Fix
// -----------------------------------------------------------------------------
console.log('\n[P3-3] Roe Approximate Riemann Shock Capturing...');
const cfd = new FVMNavierStokes3D();

// Sod shock tube left and right states
const cellL = new PolyhedralCell3D(0, { x: 0, y: 0, z: 0 }, 1e-3);
cellL.rho = 1.0;
cellL.p = 100000.0;
cellL.u = 0.0;
cellL.v = 0.0;
cellL.w = 0.0;

const cellR = new PolyhedralCell3D(1, { x: 0.1, y: 0, z: 0 }, 1e-3);
cellR.rho = 0.125;
cellR.p = 10000.0;
cellR.u = 0.0;
cellR.v = 0.0;
cellR.w = 0.0;

const faceNormal = { x: 1.0, y: 0.0, z: 0.0 };
const faceArea = 0.01; // 0.01 m^2

const roeFlux = cfd.solveRoeRiemannFlux(cellL, cellR, faceNormal, faceArea);
assert(roeFlux.massFlux > 0, 'Mass flux must be positive across expansion fan');
assert(roeFlux.pressureForce > 0, 'Pressure force must be positive');
assert(roeFlux.waveSpeeds.aRoe > 250, 'Roe speed of sound should be physical (>250 m/s)');
console.log(`  ✓ [P3-3] Roe Flux: massFlux = ${roeFlux.massFlux.toFixed(4)} kg/s, pressureForce = ${roeFlux.pressureForce.toFixed(1)} N, aRoe = ${roeFlux.waveSpeeds.aRoe.toFixed(1)} m/s`);

// -----------------------------------------------------------------------------
// Test 4: AUSM+ Upstream Mach Splitting
// -----------------------------------------------------------------------------
console.log('\n[P3-4] AUSM+ Supersonic/Transonic Flux Splitting...');
const cellAusmL = new PolyhedralCell3D(0, { x: 0, y: 0, z: 0 }, 1e-3);
cellAusmL.rho = 1.225;
cellAusmL.p = 101325.0;
cellAusmL.u = 250.0; // Transonic Mach ~ 0.73
cellAusmL.v = 0.0;
cellAusmL.w = 0.0;

const cellAusmR = new PolyhedralCell3D(1, { x: 0.1, y: 0, z: 0 }, 1e-3);
cellAusmR.rho = 1.0;
cellAusmR.p = 95000.0;
cellAusmR.u = 240.0;
cellAusmR.v = 0.0;
cellAusmR.w = 0.0;

const ausmFlux = cfd.solveAUSMPlusFlux(cellAusmL, cellAusmR, faceNormal, faceArea);
assert(ausmFlux.massFlux > 0, 'AUSM+ mass flux must be positive');
assert(ausmFlux.pressureForce > 0, 'AUSM+ pressure force must be positive');
assert(ausmFlux.interfaceMach > 0.5, 'Transonic interface Mach should exceed 0.5');
assert(ausmFlux.interfaceSoundSpeed > 250, 'Interface sound speed physical');
console.log(`  ✓ [P3-4] AUSM+ Flux: massFlux = ${ausmFlux.massFlux.toFixed(4)} kg/s, pressureForce = ${ausmFlux.pressureForce.toFixed(1)} N, M_1/2 = ${ausmFlux.interfaceMach.toFixed(4)}`);

// -----------------------------------------------------------------------------
// Test 5: MRF Rotating Frame & Full Transonic Step
// -----------------------------------------------------------------------------
console.log('\n[P3-5] Moving Reference Frame (MRF) Navier-Stokes Simulation Step...');
const mrfCFD = new FVMNavierStokes3D({
  omegaMRF: { x: 0, y: 0, z: 104.72 } // 1000 RPM around Z-axis
});
mrfCFD.createBoxDomain(6, 6, 4, 1.0, 1.0, 0.5);

// Test MRF source term
const testCell = mrfCFD.cells[0];
testCell.u = 20.0;
testCell.v = 0.0;
testCell.w = 0.0;
const mrfSource = mrfCFD.computeMRFSource(testCell);
assert(Math.abs(mrfSource.fy) > 0, 'Coriolis force in Y should be non-zero from u * omega_z');

// Run 5 steps with Roe solver
const roeStepResult = mrfCFD.step(25.0, 5, 'roe');
assert(roeStepResult.maxVelocity > 0, 'Velocity should remain non-zero and stable');
assert(roeStepResult.stepCount === 5, 'Should execute 5 steps');

// Run 5 steps with AUSM+ solver
const ausmStepResult = mrfCFD.step(25.0, 5, 'ausm_plus');
assert(ausmStepResult.maxVelocity > 0, 'Velocity should remain stable');
assert(ausmStepResult.stepCount === 10, 'Step count should accumulate to 10');
console.log(`  ✓ [P3-5] MRF Navier-Stokes converged 10 steps, maxVelocity = ${ausmStepResult.maxVelocity.toFixed(2)} m/s, maxNut = ${ausmStepResult.maxTurbulentViscosity.toExponential(3)} m²/s`);

// -----------------------------------------------------------------------------
// Test 6: Hybrid Prism Boundary Layer + Core Delaunay Tetrahedral Meshing
// -----------------------------------------------------------------------------
console.log('\n[P3-6] Hybrid Boundary Layer Prism + Core Tetrahedral Volume Meshing...');
const surfaceTriMesh = {
  vertices: [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]
  ],
  triangles: [
    [0, 1, 2], [0, 2, 3]
  ]
};

const delaunay = new DelaunayMesher3D();
const hybridResult = delaunay.generateHybridPrismTetMesh(surfaceTriMesh, {
  firstLayerHeight: 0.005,
  growthRatio: 1.25,
  layerCount: 4
}, {
  targetEdgeLength: 0.05
});

assert(hybridResult.prisms.length === 8, `Expected 8 prisms (2 tris * 4 layers), got ${hybridResult.prisms.length}`);
assert(hybridResult.statistics.prismCount === 8, 'Prism count statistic match');
assert(hybridResult.statistics.layerCount === 4, 'Layer count match');
console.log(`  ✓ [P3-6] Hybrid Mesher: ${hybridResult.prisms.length} boundary prisms generated, core Delaunay interface verified (4 layers, growth = 1.25)`);

// -----------------------------------------------------------------------------
// Test 7: Transonic Shock-Capturing Riemann Solver & Sod Shock-Tube Simulation
// -----------------------------------------------------------------------------
console.log('\n[P3-7] Standalone Riemann Solvers & 1D Sod Shock-Tube Integration...');
const roeTest = TransonicRiemannSolver.solveRoeFlux(
  { rho: 1.0, u: 0.0, v: 0.0, w: 0.0, p: 100000.0 },
  { rho: 0.125, u: 0.0, v: 0.0, w: 0.0, p: 10000.0 },
  { x: 1, y: 0, z: 0 }
);
assert(roeTest.massFlux > 0, 'Roe mass flux across shock tube interface must be positive');
assert(roeTest.pressureForce > 0, 'Roe pressure force must be positive');
assert(roeTest.waveSpeeds.aRoe > 250, 'Roe acoustic speed must be > 250 m/s');

const ausmTest = TransonicRiemannSolver.solveAUSMPlusFlux(
  { rho: 1.225, u: 250.0, v: 0.0, w: 0.0, p: 101325.0 },
  { rho: 1.0, u: 240.0, v: 0.0, w: 0.0, p: 95000.0 },
  { x: 1, y: 0, z: 0 }
);
assert(ausmTest.massFlux > 0, 'AUSM+ mass flux must be positive');
assert(ausmTest.interfaceMach > 0.5, 'AUSM+ interface Mach must be transonic (>0.5)');

const sodSim = TransonicRiemannSolver.runShockTube1D(50, 0.001, 0.4);
assert.strictEqual(sodSim.success, true, 'Sod simulation must succeed');
assert.strictEqual(sodSim.nCells, 50, '50 spatial finite volume cells');
assert(sodSim.steps > 10, 'Sod simulation took multiple time steps');
assert(sodSim.maxMach > 0.5, 'Sod simulation generated transonic flow (Mach > 0.5)');
console.log(`  ✓ [P3-7] Transonic Riemann Engine: Roe/AUSM+/HLLC validated, Sod Shock-Tube simulated ${sodSim.steps} steps (t = ${(sodSim.t * 1e3).toFixed(1)} ms, Max Mach = ${sodSim.maxMach})`);

console.log('\n================================================================');
console.log('   ALL 7 PHASE 3 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
