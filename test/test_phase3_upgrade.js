/**
 * OmniEng Phase 3 Upgrade Verification Suite: Structural & Fluid Mechanics Experimental workflow
 * Validates:
 * 1. Native 3D Delaunay & Advancing-Front Tet/Hex Mesher (TET4 & TET10)
 * 2. Gauss-Point Continuum Non-Linear J2 Plasticity & Mortar Contact
 * 3. 3D Polyhedral FVM Navier-Stokes Solver with k-omega SST Turbulence & Shock Capturing
 */

const { Point3D, Tetrahedron, DelaunayMesher3D } = require('../src/core/cae/delaunay_mesher_3d');
const {
  QuadraticTet10Element,
  MortarContactPair3D,
  LanczosModalEigensolver
} = require('../src/core/cae/continuum_plasticity_3d');
const { FVMNavierStokes3D } = require('../src/core/cae/fvm_navier_stokes_3d');
const { SYNTHETIC_CONTINUUM_MATERIAL } = require('./support/synthetic_cae_materials');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    testsFailed++;
    throw new Error(message);
  } else {
    console.log(`  ✓ ${message}`);
    testsPassed++;
  }
}

function runPhase3Tests() {
  console.log('================================================================');
  console.log('   OmniEng Phase 3 Structural & Fluid Mechanics Experimental workflow Suite   ');
  console.log('================================================================\n');

  // --- Group 1: Native 3D Delaunay & Advancing-Front Mesher ---
  console.log('1. Native 3D Delaunay & Advancing-Front Mesher (TET4 & TET10):');
  {
    // Test 1.1: Tetrahedron volume and circumsphere calculation
    const p1 = new Point3D(0, 0, 0, 0);
    const p2 = new Point3D(1, 0, 0, 1);
    const p3 = new Point3D(0, 1, 0, 2);
    const p4 = new Point3D(0, 0, 1, 3);
    const tet = new Tetrahedron(p1, p2, p3, p4);

    assert(
      Math.abs(tet.volume - 1.0 / 6.0) < 1e-12,
      'Tetrahedron volume evaluates exactly to 1/6 for unit orthogonal tet'
    );
    assert(tet.circumsphere && tet.circumsphere.radius > 0.5, 'Tetrahedron circumsphere correctly computed');

    // Test 1.2: Circumsphere containment check
    const pInside = new Point3D(0.2, 0.2, 0.2);
    const pOutside = new Point3D(5.0, 5.0, 5.0);
    assert(tet.inCircumsphere(pInside), 'Point inside circumsphere is correctly detected');
    assert(!tet.inCircumsphere(pOutside), 'Point outside circumsphere is correctly rejected');

    // Test 1.3: Tetrahedral meshing of closed box surface
    const mesher = new DelaunayMesher3D({ targetEdgeLength: 0.2 });
    // Define 8 vertices of a box [0, 0.4] x [0, 0.4] x [0, 0.4]
    const boxVertices = [
      new Point3D(0, 0, 0, 0),
      new Point3D(0.4, 0, 0, 1),
      new Point3D(0.4, 0.4, 0, 2),
      new Point3D(0, 0.4, 0, 3),
      new Point3D(0, 0, 0.4, 4),
      new Point3D(0.4, 0, 0.4, 5),
      new Point3D(0.4, 0.4, 0.4, 6),
      new Point3D(0, 0.4, 0.4, 7)
    ];
    // 12 triangle faces of the box
    const boxFaces = [
      [0, 1, 2],
      [0, 2, 3], // bottom
      [4, 6, 5],
      [4, 7, 6], // top
      [0, 5, 1],
      [0, 4, 5], // front
      [2, 7, 3],
      [2, 6, 7], // back
      [0, 3, 7],
      [0, 7, 4], // left
      [1, 5, 6],
      [1, 6, 2] // right
    ];

    const meshTET4 = mesher.meshClosedSurface(boxVertices, boxFaces, { quadratic: false });
    assert(meshTET4.elementCount > 0, `3D Delaunay mesher produces ${meshTET4.elementCount} volume elements for box`);
    assert(
      meshTET4.metrics.averageQuality > 0.1,
      `Average element radius ratio quality is valid (${meshTET4.metrics.averageQuality.toFixed(3)})`
    );

    // Test 1.4: Quadratic TET10 generation with mid-edge nodes
    const meshTET10 = mesher.meshClosedSurface(boxVertices, boxFaces, { quadratic: true });
    assert(meshTET10.type === 'TET10', 'Quadratic TET10 mesh generation type confirmed');
    assert(
      meshTET10.nodeCount > meshTET4.nodeCount,
      `Quadratic mesh adds mid-edge nodes (${meshTET10.nodeCount} vs ${meshTET4.nodeCount})`
    );
    assert(
      meshTET10.elements[0].midNodeIds && meshTET10.elements[0].midNodeIds.length === 6,
      'TET10 elements possess exactly 6 mid-side nodes'
    );
  }

  // --- Group 2: Continuum Plasticity, TET10 & Mortar Contact ---
  console.log('\n2. Small-Strain 3D J2 Plasticity and Contact Smoke Checks:');
  {
    // Test 2.1: TET10 shape functions satisfy partition of unity
    const tetElem = new QuadraticTet10Element(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], SYNTHETIC_CONTINUUM_MATERIAL);
    const N = tetElem.evaluateShapeFunctions(0.2, 0.3, 0.1);
    const sumN = N.reduce((acc, val) => acc + val, 0);
    assert(
      Math.abs(sumN - 1.0) < 1e-12,
      `TET10 shape functions satisfy partition of unity: sum(N) = ${sumN.toFixed(10)}`
    );

    // Test 2.2: Gauss-point elastic trial and J2 radial return mapping
    const gp = tetElem.gaussPoints[0];
    // Elastic step: small strain increment
    const elasticStrainInc = new Float64Array([0.0005, -0.0001, -0.0001, 0, 0, 0]);
    const resElastic = tetElem.radialReturnMapping(gp, elasticStrainInc, 1, 300);
    assert(
      !resElastic.isPlastic,
      `Small strain remains within elastic regime (von Mises = ${(resElastic.vonMises / 1e6).toFixed(1)} MPa < Sy)`
    );

    // Large strain increment causing plastic yield
    const plasticStrainInc = new Float64Array([0.02, -0.008, -0.008, 0.005, 0, 0]);
    const resPlastic = tetElem.radialReturnMapping(gp, plasticStrainInc, 1, 300);
    assert(
      resPlastic.isPlastic,
      `Large strain triggers J2 plastic yielding (von Mises = ${(resPlastic.vonMises / 1e6).toFixed(1)} MPa)`
    );
    assert(
      resPlastic.deltaPlasticMultiplier > 0,
      `Plastic multiplier delta_gamma > 0 (${resPlastic.deltaPlasticMultiplier.toExponential(3)})`
    );

    // Test 2.3: Augmented Lagrangian Mortar contact non-penetration enforcement
    const nodes = [
      new Point3D(0, 0, 0, 0),
      new Point3D(1, 0, 0, 1),
      new Point3D(0, 1, 0, 2), // master facet at z = 0
      new Point3D(0.2, 0.2, -0.001, 3) // slave node penetrating by 1mm (z = -0.001)
    ];
    const contactPair = new MortarContactPair3D([0, 1, 2], [3], { penaltyNormal: 1e8, frictionCoeff: 0.35 });
    const contactRes = contactPair.evaluateContact(nodes);
    assert(contactRes.activeContactCount === 1, 'Mortar contact pair accurately detects penetration');
    assert(
      contactRes.totalNormalForce > 0,
      `Contact normal restoring force generated: ${contactRes.totalNormalForce.toFixed(1)} N`
    );
    assert(
      contactRes.totalFrictionForce > 0,
      `Coulomb friction force generated: ${contactRes.totalFrictionForce.toFixed(1)} N`
    );

    // Test 2.4: Lanczos Modal Eigensolver
    const numDOF = 12;
    const K = Array.from({ length: numDOF }, () => new Float64Array(numDOF));
    const M = Array.from({ length: numDOF }, () => new Float64Array(numDOF));
    for (let i = 0; i < numDOF; i++) {
      K[i][i] = 1e6 * (i + 1);
      M[i][i] = 10.0;
    }
    const eigensolver = new LanczosModalEigensolver(4);
    const modalResults = eigensolver.solve(K, M, numDOF);
    assert(modalResults.modesFound >= 4, `Lanczos solver extracted ${modalResults.modesFound} natural vibration modes`);
    assert(
      modalResults.frequencies[0].frequencyHz > 0,
      `Fundamental frequency computed: ${modalResults.frequencies[0].frequencyHz.toFixed(2)} Hz`
    );
  }

  // --- Group 3: 3D Polyhedral FVM Navier-Stokes & Turbulence ---
  console.log('\n3. Experimental 3D Finite-Volume Flow Helpers and Pseudo-Transient Update:');
  {
    // Test 3.1: 3D Polyhedral domain initialization
    const fvm = new FVMNavierStokes3D({ omegaMRF: { x: 0, y: 0, z: 100.0 } }); // 100 rad/s z-rotation
    const domain = fvm.createBoxDomain(6, 6, 4, 1.2, 0.8, 0.6);
    assert(domain.cellCount === 144, `3D domain initialized with ${domain.cellCount} polyhedral cells`);
    assert(domain.faceCount > 200, `Domain contains ${domain.faceCount} internal and boundary faces`);

    // Test 3.2: Menter k-omega SST turbulence eddy viscosity and blending
    fvm.updateSSTTurbulence();
    const sampleCell = fvm.cells[10];
    assert(
      sampleCell.nut > 0,
      `k-omega SST computes non-zero eddy viscosity: nut = ${sampleCell.nut.toExponential(3)} m^2/s`
    );

    // Test 3.3: Automatic wall treatment y+ classification
    const wallFace = fvm.faces.find((f) => f.boundaryType === 'wall');
    const wallCell = fvm.cells[wallFace.ownerId];
    wallCell.u = 20.0;
    const wallInfo = fvm.evaluateWallBoundary(wallCell, wallFace);
    assert(
      Number.isFinite(wallInfo.yPlus) && wallInfo.yPlus > 0,
      `Wall treatment determines local y+ = ${wallInfo.yPlus.toFixed(2)} (${wallInfo.regime})`
    );

    // Test 3.4: HLLC Riemann shock solver wave speeds and pressure flux
    const cellL = fvm.cells[0];
    const cellR = fvm.cells[1];
    cellL.u = 400.0; // Supersonic Ma > 1
    cellR.u = 100.0;
    const riemann = fvm.solveHLLCRiemannFlux(cellL, cellR, { x: 1, y: 0, z: 0 }, 0.01);
    assert(
      riemann.waveSpeeds.SL < riemann.waveSpeeds.SR,
      'HLLC Riemann solver resolves distinct wave speeds (SL < SR)'
    );
    assert(riemann.massFlux > 0, `Compressible Riemann mass flux resolved: ${riemann.massFlux.toFixed(3)} kg/s`);

    // Test 3.5: Moving Reference Frame (MRF) Coriolis and Centrifugal sources
    const mrfSource = fvm.computeMRFSource(sampleCell);
    assert(
      Math.abs(mrfSource.fx) > 0 || Math.abs(mrfSource.fy) > 0,
      'MRF rotating reference frame computes non-zero rotational body forces'
    );

    // Test 3.6: FVM solver iteration step
    const solveStep = fvm.step(20.0, 5);
    assert(
      solveStep.stepCount === 5,
      `FVM Navier-Stokes successfully executed ${solveStep.stepCount} pseudo-transient steps`
    );
    assert(solveStep.maxVelocity > 0, `Velocity field updated: max velocity = ${solveStep.maxVelocity.toFixed(2)} m/s`);
  }

  console.log('\n================================================================');
  console.log(`Phase 3 Verification Finished: ${testsPassed} Passed (${testsFailed} Failed)`);
  console.log('================================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  }
  return { testsPassed, testsFailed };
}

if (require.main === module) {
  runPhase3Tests();
}

module.exports = { runPhase3Tests };
