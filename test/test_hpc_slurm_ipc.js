/**
 * test_hpc_slurm_ipc.js
 *
 * Verification suite for HPC Slurm MPI Gateway, OpenFOAM Case Generator,
 * CalculiX Case Generator, and their IPC handlers.
 *
 * Checks:
 * 1. Slurm batch script generation scaling from 1 up to 10,240 cores with
 *    Scotch/Metis domain decomposition, walltimes, partitions, and MPI bindings.
 * 2. OpenFOAM case deck generation (controlDict, fvSchemes, fvSolution,
 *    blockMeshDict, decomposeParDict) for rhoCentralFoam shock CFD and interFoam VOF.
 * 3. CalculiX case deck generation for non-linear plastic FEA and dynamic explicit analysis.
 * 4. Solver telemetry parser extracting convergence residuals for Ux, Uy, Uz, p, T, k, omega.
 * 5. Full IPC handler invocation and response format for all registered channels.
 * 6. Electron preload API exposure under window.electronAPI.hpc.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');
const fs = require('fs');

const { SlurmClusterGateway } = require('../src/core/hpc/slurm_mpi_cluster_gateway');
const { OpenFoamCaseGenerator } = require('../src/core/hpc/openfoam_case_generator');
const { CalculixCaseGenerator } = require('../src/core/hpc/calculix_case_generator');
const { registerHpcIpc, parseSolverTelemetry } = require('../src/main/ipc/hpc_ipc');
const defineHandlerModule = require('../src/main/ipc/define_handler');

async function runTests() {
  console.log('================================================================');
  console.log('  HPC SLURM & MULTIPHYSICS GATEWAY IPC VERIFICATION SUITE       ');
  console.log('================================================================\n');

  let totalChecks = 0;
  let passedChecks = 0;

  async function check(title, fn) {
    totalChecks++;
    try {
      await fn();
      passedChecks++;
      console.log(`  ✓ PASS: ${title}`);
    } catch (err) {
      console.error(`  ✗ FAIL: ${title}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // ============================================================================
  // 1. Slurm Batch Script Scaling up to 10,240 Cores
  // ============================================================================
  console.log('[1] Slurm Batch Script Generation & High-Core Scaling (up to 10,240 cores)...');

  await check('Slurm: Single-core baseline generation (1 core, 1 node)', () => {
    const gateway = new SlurmClusterGateway({ partition: 'debug', timeLimit: '00:30:00' });
    const script = gateway.generateBatchScript({
      jobName: 'single_core_run',
      nodes: 1,
      ntasksPerNode: 1,
      cores: 1,
      walltime: '00:15:00',
      solverType: 'openfoam',
      executable: 'rhoCentralFoam'
    });

    assert.ok(script.includes('#SBATCH --nodes=1'), '1 node required');
    assert.ok(script.includes('#SBATCH --ntasks-per-node=1'), '1 task per node required');
    assert.ok(script.includes('#SBATCH --time=00:15:00'), 'Time limit respected');
    assert.ok(script.includes('srun --mpi=pmix -n 1 rhoCentralFoam'), '1 MPI rank in srun');

    const directives = gateway.parseDirectives(script, 'slurm');
    assert.strictEqual(directives.nodes, '1');
    assert.strictEqual(directives['ntasks-per-node'], '1');
    assert.strictEqual(directives.time, '00:15:00');
    assert.strictEqual(directives.partition, 'debug');
  });

  await check('Slurm: High-performance scaling to 2,048 cores on 32 nodes', () => {
    const gateway = new SlurmClusterGateway({ partition: 'compute', defaultNodes: 32, tasksPerNode: 64 });
    const script = gateway.generateBatchScript({
      jobName: 'shock_wedge_2048',
      nodes: 32,
      ntasksPerNode: 64,
      walltime: '12:00:00',
      solverType: 'openfoam',
      executable: 'rhoCentralFoam',
      mpiBindings: 'cores'
    });

    assert.ok(script.includes('#SBATCH --nodes=32'));
    assert.ok(script.includes('#SBATCH --ntasks-per-node=64'));
    assert.ok(script.includes('#SBATCH --cpu-bind=cores'), 'CPU core binding present');
    assert.ok(script.includes('srun --mpi=pmix --cpu-bind=cores -n 2048 rhoCentralFoam'), '2048 MPI ranks launched');
    assert.ok(script.includes('decomposePar -force'), 'Automatic domain decomposition included');
    assert.ok(script.includes('reconstructPar -latestTime'), 'Mesh reconstruction included');

    const directives = gateway.parseDirectives(script, 'slurm');
    assert.strictEqual(directives.nodes, '32');
    assert.strictEqual(directives['ntasks-per-node'], '64');
    assert.strictEqual(directives['cpu-bind'], 'cores');
  });

  await check('Slurm: Massive supercomputer scaling to 10,240 cores on 160 nodes', () => {
    const gateway = new SlurmClusterGateway({ partition: 'standard', timeLimit: '48:00:00' });
    const script = gateway.generateBatchScript({
      jobName: 'hypersonic_boundary_layer_10k',
      nodes: 160,
      ntasksPerNode: 64,
      cores: 10240,
      walltime: '24:00:00',
      partition: 'hpc-large',
      solverType: 'openfoam',
      executable: 'rhoCentralFoam',
      mpiBindings: 'cores',
      env: { OMP_NUM_THREADS: '1', FOAM_SIGFPE: '1' }
    });

    assert.ok(script.includes('#SBATCH --job-name=hypersonic_boundary_layer_10k'));
    assert.ok(script.includes('#SBATCH --nodes=160'), '160 nodes allocated');
    assert.ok(script.includes('#SBATCH --ntasks-per-node=64'), '64 tasks per node allocated');
    assert.ok(script.includes('#SBATCH --partition=hpc-large'), 'Custom partition applied');
    assert.ok(script.includes('#SBATCH --time=24:00:00'), 'Walltime evaluated correctly');
    assert.ok(script.includes('#SBATCH --cpu-bind=cores'), 'MPI core binding directive present');
    assert.ok(script.includes('srun --mpi=pmix --cpu-bind=cores -n 10240 rhoCentralFoam -parallel'));
    assert.ok(script.includes('export OMP_NUM_THREADS=1'));
    assert.ok(script.includes('export FOAM_SIGFPE=1'));

    const validation = gateway.validateScript(script, 'slurm');
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.missing.length, 0);

    // Check Scotch domain decomposition for 10,240 ranks
    const decompScotch = gateway.generateDecomposeParDict(10240, 'scotch');
    assert.ok(decompScotch.includes('numberOfSubdomains 10240;'));
    assert.ok(decompScotch.includes('method          scotch;'));

    // Check Metis domain decomposition for 10,240 ranks
    const decompMetis = gateway.generateDecomposeParDict(10240, 'metis');
    assert.ok(decompMetis.includes('numberOfSubdomains 10240;'));
    assert.ok(decompMetis.includes('method          metis;'));
  });

  await check('PBS Pro: Batch script generation with nodes, ppn, and walltime', () => {
    const gateway = new SlurmClusterGateway({ queue: 'batchq' });
    const script = gateway.generateBatchScript({
      scheduler: 'pbs',
      jobName: 'pbs_extreme_scale',
      nodes: 80,
      ntasksPerNode: 64,
      cores: 5120,
      walltime: '08:00:00',
      queue: 'priorityq',
      solverType: 'calculix',
      mpiBindings: 'core'
    });

    assert.ok(script.includes('#PBS -N pbs_extreme_scale'));
    assert.ok(script.includes('#PBS -q priorityq'));
    assert.ok(script.includes('#PBS -l nodes=80:ppn=64'));
    assert.ok(script.includes('#PBS -l walltime=08:00:00'));
    assert.ok(script.includes('mpirun --bind-to core -np 5120 ccx_2.21 -i "pbs_extreme_scale"'));

    const validation = gateway.validateScript(script, 'pbs');
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.missing.length, 0);
  });

  // ============================================================================
  // 2. OpenFOAM Case Deck Generation
  // ============================================================================
  console.log('\n[2] OpenFOAM Case Deck Generation (rhoCentralFoam shock CFD & interFoam VOF)...');

  await check('OpenFOAM: Complete case tree with rhoCentralFoam compressible shock CFD', () => {
    const tree = OpenFoamCaseGenerator.generateCaseTree({
      application: 'rhoCentralFoam',
      controlDict: {
        application: 'rhoCentralFoam',
        startTime: 0,
        endTime: 0.05,
        deltaT: 1e-6,
        writeInterval: 0.001,
        maxCo: 0.4
      },
      fvSchemes: { isCompressible: true },
      numberOfSubdomains: 128,
      decomposeMethod: 'scotch',
      fluid: { rho: 1.225, nu: 1.5e-5, mu: 1.8e-5, Cp: 1005, Pr: 0.72 },
      uField: { inletVelocity: [900, 0, 0] }
    });

    const expectedFiles = [
      'system/controlDict',
      'system/fvSchemes',
      'system/fvSolution',
      'system/blockMeshDict',
      'system/decomposeParDict',
      'constant/transportProperties',
      '0/U'
    ];

    for (const relPath of expectedFiles) {
      assert.ok(tree[relPath], `Case tree must contain ${relPath}`);
      assert.ok(typeof tree[relPath] === 'string' && tree[relPath].length > 50);
    }

    // controlDict checks
    assert.ok(tree['system/controlDict'].includes('application     rhoCentralFoam;'));
    assert.ok(tree['system/controlDict'].includes('maxCo           0.4;'));

    // fvSchemes checks
    assert.ok(tree['system/fvSchemes'].includes('reconstruct(rho) vanLeer;'));
    assert.ok(tree['system/fvSchemes'].includes('reconstruct(U)   vanLeerV;'));
    assert.ok(tree['system/fvSchemes'].includes('reconstruct(T)   vanLeer;'));

    // fvSolution checks
    assert.ok(tree['system/fvSolution'].includes('solver          PBiCG;'));
    assert.ok(tree['system/fvSolution'].includes('preconditioner  DIC;'));

    // decomposeParDict checks
    assert.ok(tree['system/decomposeParDict'].includes('numberOfSubdomains 128;'));
    assert.ok(tree['system/decomposeParDict'].includes('method          scotch;'));

    // boundary velocity
    assert.ok(tree['0/U'].includes('uniform (900 0 0);'));
  });

  await check('OpenFOAM: Case deck with interFoam VOF multiphase and Metis decomposition', () => {
    const tree = OpenFoamCaseGenerator.generateCaseTree({
      application: 'interFoam',
      controlDict: {
        application: 'interFoam',
        startTime: 0,
        endTime: 2.0,
        deltaT: 0.001,
        writeInterval: 0.05,
        maxCo: 0.5
      },
      fvSchemes: { isCompressible: false },
      numberOfSubdomains: 512,
      decomposeMethod: 'metis',
      fluid: { rho: 1000, nu: 1e-6, mu: 1e-3, Cp: 4182, Pr: 7.0 },
      uField: { inletVelocity: [2.5, 0, 0] }
    });

    assert.ok(tree['system/controlDict'].includes('application     interFoam;'));
    assert.ok(tree['system/decomposeParDict'].includes('numberOfSubdomains 512;'));
    assert.ok(tree['system/decomposeParDict'].includes('method          metis;'));
    assert.ok(tree['system/fvSolution'].includes('"alpha.*"'));
    assert.ok(tree['0/U'].includes('uniform (2.5 0 0);'));
  });

  // ============================================================================
  // 3. CalculiX Case Deck Generation
  // ============================================================================
  console.log('\n[3] CalculiX Case Deck Generation (Non-Linear Plastic FEA & Dynamic Explicit)...');

  await check('CalculiX: Non-linear plastic FEA input deck with element sets and boundary conditions', () => {
    const nodes = [
      [1, 0, 0, 0],
      [2, 20, 0, 0],
      [3, 20, 20, 0],
      [4, 0, 20, 0],
      [5, 0, 0, 20],
      [6, 20, 0, 20],
      [7, 20, 20, 20],
      [8, 0, 20, 20]
    ];
    const elements = [[1, 1, 2, 3, 4, 5, 6, 7, 8]];
    const nodeSets = {
      FIXED_BASE: [1, 2, 3, 4],
      TOP_LOAD: [5, 6, 7, 8]
    };

    const deck = CalculixCaseGenerator.generateInputDeck({
      heading: 'Cantilever Hex8 Non-Linear Elastoplasticity',
      nodes,
      elements,
      elementType: 'C3D8',
      materialName: 'TI6AL4V',
      youngsModulus_MPa: 113800,
      poissonsRatio: 0.342,
      yieldStress_MPa: 880,
      hardeningStrain: 0.12,
      nodeSets,
      boundaryConditions: [{ set: 'FIXED_BASE', dofs: [1, 3], value: 0 }],
      appliedLoads: [{ set: 'TOP_LOAD', dof: 3, magnitude: -25000 }],
      isNonLinearGeom: true,
      stepType: 'STATIC'
    });

    assert.ok(deck.includes('*HEADING'));
    assert.ok(deck.includes('*ELEMENT, TYPE=C3D8, ELSET=EBODY'));
    assert.ok(deck.includes('*MATERIAL, NAME=TI6AL4V'));
    assert.ok(deck.includes('*ELASTIC'));
    assert.ok(deck.includes('113800, 0.342'));
    assert.ok(deck.includes('*PLASTIC'));
    assert.ok(deck.includes('880, 0.0'));
    assert.ok(deck.includes('*NSET, NSET=FIXED_BASE'));
    assert.ok(deck.includes('*BOUNDARY'));
    assert.ok(deck.includes('FIXED_BASE, 1, 3, 0'));
    assert.ok(deck.includes('*STEP, NLGEOM'));
    assert.ok(deck.includes('*STATIC'));
    assert.ok(deck.includes('*CLOAD'));
    assert.ok(deck.includes('TOP_LOAD, 3, -25000'));
    assert.ok(deck.includes('*END STEP'));

    const parsed = CalculixCaseGenerator.parseDeck(deck);
    assert.strictEqual(parsed.elementType, 'C3D8');
    assert.strictEqual(parsed.nodes.length, 8);
    assert.strictEqual(parsed.elements.length, 1);
    assert.strictEqual(parsed.elastic, '113800, 0.342');
    assert.ok(parsed.plastic.includes('880, 0.0'));
    assert.strictEqual(parsed.step, '*STEP, NLGEOM');
    assert.strictEqual(parsed.hasEndStep, true);
  });

  await check('CalculiX: Dynamic explicit analysis deck with density and C3D8R reduced integration', () => {
    const nodes = [
      [1, 0, 0, 0],
      [2, 10, 0, 0],
      [3, 10, 10, 0],
      [4, 0, 10, 0],
      [5, 0, 0, 10],
      [6, 10, 0, 10],
      [7, 10, 10, 10],
      [8, 0, 10, 10]
    ];
    const elements = [[1, 1, 2, 3, 4, 5, 6, 7, 8]];

    const deck = CalculixCaseGenerator.generateInputDeck({
      heading: 'Explicit Dynamic Crash Hex8R',
      nodes,
      elements,
      elementType: 'C3D8R',
      materialName: 'HIGH_STRENGTH_STEEL',
      youngsModulus_MPa: 210000,
      poissonsRatio: 0.3,
      yieldStress_MPa: 650,
      density_kg_m3: 7850,
      stepType: 'DYNAMIC, EXPLICIT',
      isNonLinearGeom: true
    });

    assert.ok(deck.includes('*ELEMENT, TYPE=C3D8R, ELSET=EBODY'));
    assert.ok(deck.includes('*DENSITY'));
    assert.ok(deck.includes('7850'));
    assert.ok(deck.includes('*STEP, NLGEOM'));
    assert.ok(deck.includes('*DYNAMIC, EXPLICIT'));

    const parsed = CalculixCaseGenerator.parseDeck(deck);
    assert.strictEqual(parsed.elementType, 'C3D8R');
    assert.strictEqual(parsed.density, '7850');
    assert.strictEqual(parsed.step, '*STEP, NLGEOM');
    assert.strictEqual(parsed.hasEndStep, true);
  });

  // ============================================================================
  // 4. Solver Log Stream Telemetry Parser
  // ============================================================================
  console.log('\n[4] Solver Log Telemetry Parser (Residuals for Ux, Uy, Uz, p, T, k, omega)...');

  await check('Telemetry: Live OpenFOAM log stream parsing with complete variable set', () => {
    const sampleLog = `
Starting time loop

Time = 0.001
Solving for Ux, Initial residual = 0.045123, Final residual = 0.00012, No Iterations 5
Solving for Uy, Initial residual = 0.021456, Final residual = 0.00008, No Iterations 4
Solving for Uz, Initial residual = 0.033789, Final residual = 0.00009, No Iterations 4
Solving for p, Initial residual = 0.120541, Final residual = 0.00045, No Iterations 8
Solving for T, Initial residual = 0.015234, Final residual = 0.00003, No Iterations 3
Solving for k, Initial residual = 0.008912, Final residual = 0.00002, No Iterations 3
Solving for omega, Initial residual = 0.007654, Final residual = 0.00001, No Iterations 3
ExecutionTime = 1.25 s  ClockTime = 2 s

Time = 0.002
Solving for Ux, Initial residual = 0.00085, Final residual = 0.00001, No Iterations 3
Solving for Uy, Initial residual = 0.00042, Final residual = 0.00001, No Iterations 3
Solving for Uz, Initial residual = 0.00063, Final residual = 0.00001, No Iterations 3
Solving for p, Initial residual = 0.00095, Final residual = 0.00002, No Iterations 4
Solving for T, Initial residual = 0.00021, Final residual = 0.00001, No Iterations 2
Solving for k, Initial residual = 0.00015, Final residual = 0.00001, No Iterations 2
Solving for omega, Initial residual = 0.00011, Final residual = 0.00001, No Iterations 2
ExecutionTime = 2.45 s  ClockTime = 3 s
`;

    const telemetry = parseSolverTelemetry(sampleLog, 'openfoam', 1e-3);

    assert.strictEqual(telemetry.solver, 'openfoam');
    assert.strictEqual(telemetry.totalIterations, 2);
    assert.strictEqual(telemetry.latestTime, 0.002);

    // Check iteration 1
    assert.strictEqual(telemetry.iterations[0].time, 0.001);
    assert.strictEqual(telemetry.iterations[0].residuals.Ux, 0.045123);
    assert.strictEqual(telemetry.iterations[0].residuals.Uy, 0.021456);
    assert.strictEqual(telemetry.iterations[0].residuals.Uz, 0.033789);
    assert.strictEqual(telemetry.iterations[0].residuals.p, 0.120541);
    assert.strictEqual(telemetry.iterations[0].residuals.T, 0.015234);
    assert.strictEqual(telemetry.iterations[0].residuals.k, 0.008912);
    assert.strictEqual(telemetry.iterations[0].residuals.omega, 0.007654);

    // Check iteration 2 convergence: all residuals < 1e-3
    assert.strictEqual(telemetry.latestResiduals.Ux, 0.00085);
    assert.strictEqual(telemetry.latestResiduals.Uy, 0.00042);
    assert.strictEqual(telemetry.latestResiduals.Uz, 0.00063);
    assert.strictEqual(telemetry.latestResiduals.p, 0.00095);
    assert.strictEqual(telemetry.latestResiduals.T, 0.00021);
    assert.strictEqual(telemetry.latestResiduals.k, 0.00015);
    assert.strictEqual(telemetry.latestResiduals.omega, 0.00011);

    assert.strictEqual(telemetry.converged, true, 'Convergence threshold satisfied');
    assert.ok(telemetry.monitoredVariables.includes('Ux'));
    assert.ok(telemetry.monitoredVariables.includes('Uy'));
    assert.ok(telemetry.monitoredVariables.includes('Uz'));
    assert.ok(telemetry.monitoredVariables.includes('p'));
    assert.ok(telemetry.monitoredVariables.includes('T'));
    assert.ok(telemetry.monitoredVariables.includes('k'));
    assert.ok(telemetry.monitoredVariables.includes('omega'));
  });

  await check('Telemetry: CalculiX CCX solver log telemetry extraction', () => {
    const ccxLog = `
CalculiX Version 2.21, solver ccx_2.21
STEP 1 INCREMENT 1
  TIME = 0.100000
  EQUILIBRIUM ITERATION 1
  FORCE RESIDUAL = 0.084200
  DISPLACEMENT RESIDUAL = 0.012500
  EQUILIBRIUM ITERATION 2
  FORCE RESIDUAL = 0.000320
  DISPLACEMENT RESIDUAL = 0.000045
`;

    const telemetry = parseSolverTelemetry(ccxLog, 'calculix', 1e-3);
    assert.strictEqual(telemetry.solver, 'calculix');
    assert.ok(telemetry.totalIterations >= 2);
    assert.strictEqual(telemetry.converged, true);
    assert.ok(telemetry.monitoredVariables.includes('force'));
    assert.ok(telemetry.monitoredVariables.includes('displacement'));
  });

  // ============================================================================
  // 5. IPC Handler Invocation & Response Verification
  // ============================================================================
  console.log('\n[5] HPC IPC Handler Registration, Invocation & Response Contract...');

  const registeredHandlers = new Map();
  const mockIpcMain = {
    handle: (channel, handler) => {
      registeredHandlers.set(channel, handler);
    }
  };

  const repositoryRoot = path.resolve(__dirname, '..');
  const entryUrl = pathToFileURL(path.join(repositoryRoot, 'src', 'index.html')).href;
  const trustedEvent = {
    sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
    senderFrame: { frameTreeNodeId: 42, url: entryUrl }
  };

  defineHandlerModule.channelRegistry.clear();
  defineHandlerModule.withIpcMain(mockIpcMain, () => {
    registerHpcIpc();
  });

  await check('IPC: All 4 HPC channels successfully registered in defineHandler', () => {
    const channels = [
      'hpc:generate-slurm-batch-script',
      'hpc:generate-openfoam-case',
      'hpc:generate-calculix-case',
      'hpc:parse-solver-telemetry'
    ];

    for (const ch of channels) {
      assert.ok(registeredHandlers.has(ch), `Handler for '${ch}' must be registered`);
      assert.strictEqual(defineHandlerModule.isChannelRegistered(ch), true);
    }
  });

  await check('IPC: hpc:generate-slurm-batch-script handler execution for 10,240 cores', async () => {
    const handler = registeredHandlers.get('hpc:generate-slurm-batch-script');
    const res = await handler(trustedEvent, {
      jobName: 'shock_cluster_10240',
      nodes: 160,
      ntasksPerNode: 64,
      walltime: '18:00:00',
      partition: 'hpc-compute',
      mpiBindings: 'cores',
      decomposeMethod: 'metis',
      executable: 'rhoCentralFoam'
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.scheduler, 'slurm');
    assert.strictEqual(res.totalCores, 10240);
    assert.strictEqual(res.nodes, 160);
    assert.strictEqual(res.ntasksPerNode, 64);
    assert.strictEqual(res.partition, 'hpc-compute');
    assert.strictEqual(res.valid, true);
    assert.ok(res.script.includes('#SBATCH --nodes=160'));
    assert.ok(res.script.includes('srun --mpi=pmix --cpu-bind=cores -n 10240 rhoCentralFoam'));
    assert.ok(res.decomposeParDict.includes('numberOfSubdomains 10240;'));
    assert.ok(res.decomposeParDict.includes('method          metis;'));
  });

  await check('IPC: hpc:generate-openfoam-case handler execution (rhoCentralFoam & interFoam)', async () => {
    const handler = registeredHandlers.get('hpc:generate-openfoam-case');

    // Test compressible shock CFD
    const resShock = await handler(trustedEvent, {
      application: 'rhoCentralFoam',
      startTime: 0,
      endTime: 0.02,
      subdomains: 64,
      decomposeMethod: 'scotch'
    });
    assert.strictEqual(resShock.success, true);
    assert.strictEqual(resShock.solver, 'rhoCentralFoam');
    assert.strictEqual(resShock.isCompressible, true);
    assert.strictEqual(resShock.subdomains, 64);
    assert.strictEqual(resShock.fileCount, 7);
    assert.ok(resShock.files['system/controlDict'].includes('rhoCentralFoam;'));
    assert.ok(resShock.files['system/decomposeParDict'].includes('numberOfSubdomains 64;'));

    // Test VOF multiphase
    const resVof = await handler(trustedEvent, {
      application: 'interFoam',
      startTime: 0,
      endTime: 1.0,
      subdomains: 256,
      decomposeMethod: 'metis'
    });
    assert.strictEqual(resVof.success, true);
    assert.strictEqual(resVof.solver, 'interFoam');
    assert.strictEqual(resVof.isCompressible, false);
    assert.strictEqual(resVof.subdomains, 256);
    assert.ok(resVof.files['system/controlDict'].includes('interFoam;'));
    assert.ok(resVof.files['system/decomposeParDict'].includes('numberOfSubdomains 256;'));
    assert.ok(resVof.files['system/decomposeParDict'].includes('method          metis;'));
  });

  await check('IPC: hpc:generate-calculix-case handler execution (Non-linear plastic & dynamic)', async () => {
    const handler = registeredHandlers.get('hpc:generate-calculix-case');

    // Non-linear plastic FEA
    const resPlastic = await handler(trustedEvent, {
      heading: 'Plasticity Analysis',
      elementType: 'C3D8',
      materialName: 'A36_STEEL',
      youngsModulus_MPa: 200000,
      poissonsRatio: 0.29,
      yieldStress_MPa: 250,
      hardeningStrain: 0.15,
      isNonLinearGeom: true,
      stepType: 'STATIC'
    });
    assert.strictEqual(resPlastic.success, true);
    assert.strictEqual(resPlastic.isPlastic, true);
    assert.strictEqual(resPlastic.isNonLinearGeom, true);
    assert.strictEqual(resPlastic.yieldStress_MPa, 250);
    assert.strictEqual(resPlastic.nodeCount, 8);
    assert.ok(resPlastic.deck.includes('*PLASTIC'));
    assert.ok(resPlastic.deck.includes('*STEP, NLGEOM'));

    // Dynamic explicit analysis
    const resDynamic = await handler(trustedEvent, {
      heading: 'Dynamic Impact',
      elementType: 'C3D8R',
      density_kg_m3: 7850,
      stepType: 'DYNAMIC, EXPLICIT'
    });
    assert.strictEqual(resDynamic.success, true);
    assert.strictEqual(resDynamic.stepType, 'DYNAMIC, EXPLICIT');
    assert.ok(resDynamic.deck.includes('*DENSITY'));
    assert.ok(resDynamic.deck.includes('*DYNAMIC, EXPLICIT'));
  });

  await check('IPC: hpc:parse-solver-telemetry handler execution', async () => {
    const handler = registeredHandlers.get('hpc:parse-solver-telemetry');
    const logContent = `
Time = 0.001
Solving for Ux, Initial residual = 0.025, Final residual = 0.0001, No Iterations 5
Solving for Uy, Initial residual = 0.012, Final residual = 0.0001, No Iterations 4
Solving for Uz, Initial residual = 0.018, Final residual = 0.0001, No Iterations 4
Solving for p, Initial residual = 0.035, Final residual = 0.0002, No Iterations 6
Solving for T, Initial residual = 0.008, Final residual = 0.0001, No Iterations 3
Solving for k, Initial residual = 0.004, Final residual = 0.0001, No Iterations 3
Solving for omega, Initial residual = 0.003, Final residual = 0.0001, No Iterations 3
`;

    const res = await handler(trustedEvent, {
      logContent,
      solver: 'openfoam',
      convergenceThreshold: 0.05
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.solver, 'openfoam');
    assert.strictEqual(res.totalIterations, 1);
    assert.strictEqual(res.converged, true);
    assert.strictEqual(res.latestResiduals.Ux, 0.025);
    assert.strictEqual(res.latestResiduals.Uy, 0.012);
    assert.strictEqual(res.latestResiduals.Uz, 0.018);
    assert.strictEqual(res.latestResiduals.p, 0.035);
    assert.strictEqual(res.latestResiduals.T, 0.008);
    assert.strictEqual(res.latestResiduals.k, 0.004);
    assert.strictEqual(res.latestResiduals.omega, 0.003);
  });

  // ============================================================================
  // 6. Preload API Exposure (window.electronAPI.hpc)
  // ============================================================================
  console.log('\n[6] Preload API Verification (window.electronAPI.hpc)...');

  await check('Preload: window.electronAPI.hpc exposes exact channels and dispatches to ipcRenderer', async () => {
    const preloadPath = path.join(repositoryRoot, 'preload.js');
    const preloadSource = fs.readFileSync(preloadPath, 'utf8');

    const exposed = {};
    const invocations = [];

    const mockElectron = {
      contextBridge: {
        exposeInMainWorld: (name, api) => {
          exposed[name] = api;
        }
      },
      ipcRenderer: {
        invoke: async (channel, params) => {
          invocations.push({ channel, params });
          return { success: true, channel };
        }
      }
    };

    vm.runInNewContext(
      preloadSource,
      {
        require: (mod) => {
          if (mod === 'electron') return mockElectron;
          throw new Error(`Unexpected preload require: ${mod}`);
        }
      },
      { filename: preloadPath }
    );

    assert.ok(exposed.electronAPI, 'electronAPI must be exposed in main world');
    assert.ok(exposed.electronAPI.hpc, 'electronAPI.hpc must exist');

    const hpcApi = exposed.electronAPI.hpc;
    assert.strictEqual(typeof hpcApi.generateSlurmBatchScript, 'function');
    assert.strictEqual(typeof hpcApi.generateOpenfoamCase, 'function');
    assert.strictEqual(typeof hpcApi.generateCalculixCase, 'function');
    assert.strictEqual(typeof hpcApi.parseSolverTelemetry, 'function');

    // Verify invocations trigger exact channel names
    await hpcApi.generateSlurmBatchScript({ nodes: 4 });
    assert.strictEqual(invocations[0].channel, 'hpc:generate-slurm-batch-script');

    await hpcApi.generateOpenfoamCase({ application: 'rhoCentralFoam' });
    assert.strictEqual(invocations[1].channel, 'hpc:generate-openfoam-case');

    await hpcApi.generateCalculixCase({ elementType: 'C3D8' });
    assert.strictEqual(invocations[2].channel, 'hpc:generate-calculix-case');

    await hpcApi.parseSolverTelemetry({ logContent: 'Time = 0.01' });
    assert.strictEqual(invocations[3].channel, 'hpc:parse-solver-telemetry');
  });

  console.log('\n================================================================');
  console.log(`  HPC VERIFICATION RESULTS: ${passedChecks}/${totalChecks} CHECKS PASSED`);
  console.log('================================================================\n');

  if (passedChecks !== totalChecks) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
