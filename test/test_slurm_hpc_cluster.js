/**
 * test_slurm_hpc_cluster.js
 * Verification of Slurm MPI Cluster Gateway, OpenFOAM, and CalculiX Case Generators.
 */

const assert = require('assert');
const { getSlurmGateway } = require('../src/core/hpc/slurm_mpi_cluster_gateway');
const { OpenFoamCaseGenerator } = require('../src/core/hpc/openfoam_case_generator');
const { CalculixCaseGenerator } = require('../src/core/hpc/calculix_case_generator');

console.log('[TEST] Running HPC Slurm Cluster Gateway & OpenFOAM/CalculiX Generators...');

// ==========================================
// 1. Slurm Batch Script & Domain Decomposition
// ==========================================
const gateway = getSlurmGateway({
  clusterName: 'Oakforest-HPC',
  partition: 'compute',
  defaultNodes: 32,
  tasksPerNode: 64 // 32 * 64 = 2048 MPI cores
});

const script = gateway.generateBatchScript({
  jobName: 'hypersonic_wedge_mach3',
  solverType: 'openfoam',
  executable: 'rhoCentralFoam',
  nodes: 32,
  ntasksPerNode: 64,
  casePath: '/scratch/cfd/wedge_run'
});

assert.ok(script.includes('#SBATCH --nodes=32'), 'Must declare 32 nodes');
assert.ok(script.includes('#SBATCH --ntasks-per-node=64'), 'Must declare 64 tasks per node');
assert.ok(script.includes('srun --mpi=pmix -n 2048 rhoCentralFoam -parallel'), 'Must launch 2048 MPI ranks');
assert.ok(script.includes('decomposePar -force'), 'Must include domain decomposition');
console.log('  ✓ PASS: Slurm batch script generated for 2,048 MPI ranks on 32 nodes');

// Test decomposeParDict
const decompDict = gateway.generateDecomposeParDict(2048, 'scotch');
assert.ok(decompDict.includes('numberOfSubdomains 2048;'), 'Must set 2048 subdomains');
assert.ok(decompDict.includes('method          scotch;'), 'Must specify Scotch partitioner');
console.log('  ✓ PASS: OpenFOAM decomposeParDict generated for 2,048 subdomains via Scotch');

// Test Residual Parser
const sampleLog = `
Time = 0.001
Solving for Ux, Initial residual = 0.045, Final residual = 0.00012, No Iterations 5
Solving for Uy, Initial residual = 0.021, Final residual = 0.00008, No Iterations 4
Solving for p, Initial residual = 0.120, Final residual = 0.00045, No Iterations 8
Time = 0.002
Solving for Ux, Initial residual = 0.002, Final residual = 0.00001, No Iterations 3
Solving for Uy, Initial residual = 0.001, Final residual = 0.00001, No Iterations 3
Solving for p, Initial residual = 0.015, Final residual = 0.00002, No Iterations 6
`;
const parsed = gateway.parseResiduals(sampleLog);
assert.strictEqual(parsed.length, 2, 'Must parse 2 time steps');
assert.strictEqual(parsed[0].time, 0.001);
assert.strictEqual(parsed[0].residuals.Ux, 0.045);
assert.strictEqual(parsed[1].time, 0.002);
assert.strictEqual(parsed[1].residuals.p, 0.015);
console.log('  ✓ PASS: OpenFOAM live residual parser successfully extracted time-history telemetry');

// ==========================================
// 2. OpenFOAM Case Dictionaries
// ==========================================
const controlDict = OpenFoamCaseGenerator.generateControlDict({
  application: 'rhoCentralFoam',
  endTime: 0.1,
  maxCo: 0.4
});
assert.ok(controlDict.includes('application     rhoCentralFoam;'));
assert.ok(controlDict.includes('maxCo           0.4;'));

const fvSchemes = OpenFoamCaseGenerator.generateFvSchemes({ isCompressible: true });
assert.ok(fvSchemes.includes('reconstruct(rho) vanLeer;'));
assert.ok(fvSchemes.includes('div(phi,U)      Gauss vanLeer;'));

const uField = OpenFoamCaseGenerator.generateUField({ inletVelocity: [850, 0, 0] });
assert.ok(uField.includes('uniform (850 0 0);'));
console.log('  ✓ PASS: OpenFOAM controlDict, fvSchemes, and 0/U boundary dictionaries verified');

// ==========================================
// 3. CalculiX Case Deck Generation
// ==========================================
const testNodes = [
  [1, 0, 0, 0],
  [2, 10, 0, 0],
  [3, 10, 10, 0],
  [4, 0, 10, 0],
  [5, 0, 0, 10],
  [6, 10, 0, 10],
  [7, 10, 10, 10],
  [8, 0, 10, 10]
];
const testElements = [
  [1, 1, 2, 3, 4, 5, 6, 7, 8]
];

const inpDeck = CalculixCaseGenerator.generateInputDeck({
  heading: 'Cantilever Hexahedral Non-Linear FEA',
  nodes: testNodes,
  elements: testElements,
  elementType: 'C3D8R',
  materialName: 'STRUCTURAL_STEEL',
  yieldStress_MPa: 350,
  boundaryConditions: [['NFIX', 1, 3, 0]],
  appliedLoads: [[7, 2, -5000]],
  isNonLinearGeom: true
});

assert.ok(inpDeck.includes('*ELEMENT, TYPE=C3D8R, ELSET=EBODY'));
assert.ok(inpDeck.includes('*PLASTIC'));
assert.ok(inpDeck.includes('*STEP, NLGEOM'));
assert.ok(inpDeck.includes('*CLOAD'));
assert.ok(inpDeck.includes('7, 2, -5000'));
console.log('  ✓ PASS: CalculiX .inp finite element deck generated with C3D8R elements and J2 plasticity');

console.log('[TEST] HPC Slurm & Simulation Suite: ALL CHECKS PASSED CLEANLY.\n');
