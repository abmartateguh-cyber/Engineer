/**
 * test_slurm_gateway.js
 *
 * Verification gate for the headless HPC job-submission gateway and the
 * OpenFOAM / CalculiX case-deck generators. Deterministic and dependency-free.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SlurmClusterGateway } = require('../src/core/hpc/slurm_mpi_cluster_gateway');
const { OpenFoamCaseGenerator } = require('../src/core/hpc/openfoam_case_generator');
const { CalculixCaseGenerator } = require('../src/core/hpc/calculix_case_generator');

function countBraces(text) {
  return {
    open: (text.match(/{/g) || []).length,
    close: (text.match(/}/g) || []).length
  };
}

function assertBalancedBraces(text, message) {
  const braces = countBraces(text);
  assert.ok(braces.open > 0, message + ' (must contain at least one block)');
  assert.equal(braces.open, braces.close, message + ' (unbalanced braces)');
}

// ---------------------------------------------------------------------------
// Slurm gateway
// ---------------------------------------------------------------------------

test('Slurm: generated script contains every #SBATCH directive with exact values and srun launcher', () => {
  const gateway = new SlurmClusterGateway({ partition: 'gpu', timeLimit: '24:00:00' });
  const spec = {
    scheduler: 'slurm',
    jobName: 'aerofoil_r2',
    solverType: 'openfoam',
    nodes: 4,
    ntasksPerNode: 8,
    cores: 32,
    walltime: '01:30:00',
    executable: 'rhoCentralFoam',
    args: '-parallel',
    env: { OMPI_MCA_mca_base_component_show_load_errors: '0', WM_PROJECT_DIR: '/opt/openfoam' },
    outputFile: 'aerofoil_r2_%j.log',
    errorFile: 'aerofoil_r2_%j.err',
    casePath: '/scratch/cfd/aerofoil'
  };
  const script = gateway.generateBatchScript(spec);

  assert.ok(script.includes('#SBATCH --job-name=aerofoil_r2'), 'job-name directive');
  assert.ok(script.includes('#SBATCH --output=aerofoil_r2_%j.log'), 'output directive');
  assert.ok(script.includes('#SBATCH --error=aerofoil_r2_%j.err'), 'error directive');
  assert.ok(script.includes('#SBATCH --partition=gpu'), 'partition directive');
  assert.ok(script.includes('#SBATCH --nodes=4'), 'nodes directive');
  assert.ok(script.includes('#SBATCH --ntasks-per-node=8'), 'ntasks-per-node directive');
  assert.ok(script.includes('#SBATCH --time=01:30:00'), 'time directive');
  assert.ok(script.includes('srun --mpi=pmix -n 32 rhoCentralFoam -parallel'), 'srun launcher');
  assert.ok(script.includes('module load openmpi/4.1.5'), 'module load');
  assert.ok(script.includes('export OMPI_MCA_mca_base_component_show_load_errors=0'), 'env export');

  const directives = gateway.parseDirectives(script, 'slurm');
  assert.equal(directives['job-name'], 'aerofoil_r2');
  assert.equal(directives.output, 'aerofoil_r2_%j.log');
  assert.equal(directives.error, 'aerofoil_r2_%j.err');
  assert.equal(directives.partition, 'gpu');
  assert.equal(directives.nodes, '4');
  assert.equal(directives['ntasks-per-node'], '8');
  assert.equal(directives.time, '01:30:00');

  const validated = gateway.validateScript(script, 'slurm');
  assert.equal(validated.valid, true);
  assert.deepEqual(validated.missing, []);
});

test('Slurm: dry-run submit validates required directives and rejects a broken script', () => {
  const gateway = new SlurmClusterGateway();
  const result = gateway.dryRunSubmit({
    jobName: 'dry_run_job',
    nodes: 2,
    ntasksPerNode: 4,
    walltime: '00:30:00',
    executable: 'pimpleFoam'
  });
  assert.equal(result.valid, true);
  assert.equal(result.scheduler, 'slurm');
  assert.ok(Array.isArray(result.script.split('\n')));

  const stripped = result.script.replace(/#SBATCH --partition=\S+/, '#BROKEN --partition=x');
  const bad = gateway.validateScript(stripped, 'slurm');
  assert.equal(bad.valid, false);
  assert.ok(bad.missing.includes('partition'), 'must report missing partition');
});

test('Slurm: PBS variant emits #PBS directives (nodes, ppn, walltime, queue) and mpirun launcher', () => {
  const gateway = new SlurmClusterGateway({ queue: 'workq' });
  const script = gateway.generateBatchScript({
    scheduler: 'pbs',
    jobName: 'pbs_job',
    solverType: 'custom',
    nodes: 2,
    ntasksPerNode: 8,
    cores: 16,
    walltime: '02:00:00',
    executable: 'ccx_2.21',
    args: '-i pbs_job'
  });

  assert.ok(script.includes('#PBS -N pbs_job'), 'PBS job name');
  assert.ok(script.includes('#PBS -q workq'), 'PBS queue');
  assert.ok(script.includes('#PBS -l nodes=2:ppn=8'), 'PBS nodes/ppn');
  assert.ok(script.includes('#PBS -l walltime=02:00:00'), 'PBS walltime');
  assert.ok(script.includes('#PBS -o '), 'PBS stdout');
  assert.ok(script.includes('#PBS -e '), 'PBS stderr');
  assert.ok(script.includes('mpirun -np 16 ccx_2.21 -i pbs_job'), 'mpirun launcher');

  const directives = gateway.parseDirectives(script, 'pbs');
  assert.equal(directives.queue, 'workq');
  assert.equal(directives.nodes, '2');
  assert.equal(directives.ppn, '8');
  assert.equal(directives.walltime, '02:00:00');
  assert.equal(directives['job-name'], 'pbs_job');

  const validated = gateway.validateScript(script, 'pbs');
  assert.equal(validated.valid, true);
  assert.deepEqual(validated.missing, []);
});

test('Slurm: fail-closed on negative cores, non-positive nodes, and bad walltime', () => {
  const gateway = new SlurmClusterGateway();
  assert.throws(() => gateway.generateBatchScript({ cores: -4 }), /cores/);
  assert.throws(() => gateway.generateBatchScript({ nodes: 0, ntasksPerNode: 1 }), /nodes/);
  assert.throws(() => gateway.generateBatchScript({ nodes: 1, ntasksPerNode: -1 }), /ntasksPerNode/);
  assert.throws(() => gateway.generateBatchScript({ walltime: 'tomorrow' }), /walltime/);
  assert.throws(() => gateway.generateBatchScript({ solverType: 'nope' }), /solverType/);
});

// ---------------------------------------------------------------------------
// OpenFOAM case generator
// ---------------------------------------------------------------------------

test('OpenFOAM: controlDict carries requested solver, endTime, deltaT, writeInterval', () => {
  const controlDict = OpenFoamCaseGenerator.generateControlDict({
    application: 'pimpleFoam',
    endTime: 0.1,
    deltaT: 1e-6,
    writeInterval: 0.001
  });
  assert.ok(controlDict.includes('application     pimpleFoam;'), 'solver selection');
  assert.match(controlDict, /endTime\s+0\.1;/);
  assert.match(controlDict, /deltaT\s+0\.000001;/);
  assert.match(controlDict, /writeInterval\s+0\.001;/);
  assertBalancedBraces(controlDict, 'controlDict');
});

test('OpenFOAM: fvSchemes/fvSolution are balanced dictionary blocks with PBiCG/DIC', () => {
  const fvSchemes = OpenFoamCaseGenerator.generateFvSchemes({ isCompressible: true });
  const fvSolution = OpenFoamCaseGenerator.generateFvSolution();
  assertBalancedBraces(fvSchemes, 'fvSchemes');
  assertBalancedBraces(fvSolution, 'fvSolution');
  assert.ok(fvSolution.includes('solver          PBiCG;'), 'PBiCG solver');
  assert.ok(fvSolution.includes('preconditioner  DIC;'), 'DIC preconditioner');
  assert.ok(fvSchemes.includes('div(phi,U)      Gauss vanLeer;'), 'convective scheme');
});

test('OpenFOAM: blockMeshDict has valid vertices/blocks syntax for channel and cylinder', () => {
  const channel = OpenFoamCaseGenerator.generateBlockMeshDict({ geometry: 'channel' });
  assert.ok(channel.includes('vertices'), 'vertices keyword');
  assert.ok(channel.includes('blocks'), 'blocks keyword');
  assert.ok(channel.includes('hex (0 1 2 3 4 5 6 7) (40 8 8) simpleGrading (1 1 1)'), 'hex block');
  assert.ok(channel.includes('boundary'), 'boundary keyword');
  assertBalancedBraces(channel, 'blockMeshDict channel');

  const cylinder = OpenFoamCaseGenerator.generateBlockMeshDict({ geometry: 'cylinder', cells: [16, 16, 4] });
  assert.ok(cylinder.includes('hex (0 1 2 3 4 5 6 7) (16 16 4) simpleGrading (1 1 1)'), 'cylinder block');
  assertBalancedBraces(cylinder, 'blockMeshDict cylinder');
});

test('OpenFOAM: case tree contains every required file', () => {
  const tree = OpenFoamCaseGenerator.generateCaseTree({
    controlDict: { application: 'interFoam', endTime: 0.5, deltaT: 1e-4 },
    fluid: { rho: 998, nu: 1e-6, mu: 1e-3, Cp: 4182, Pr: 7.0 }
  });
  const required = [
    'system/controlDict',
    'system/fvSchemes',
    'system/fvSolution',
    'system/blockMeshDict',
    'constant/transportProperties'
  ];
  for (const path of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(tree, path), `missing ${path}`);
    assert.ok(typeof tree[path] === 'string' && tree[path].length > 0, `${path} must be non-empty`);
  }
  assert.ok(tree['system/controlDict'].includes('application     interFoam;'));
  assert.ok(tree['constant/transportProperties'].includes('transportModel  Newtonian;'));
});

test('OpenFOAM: fail-closed on invalid solver name', () => {
  assert.throws(() => OpenFoamCaseGenerator.generateControlDict({ application: 'mysterySolver' }), /solver/);
  assert.throws(() => OpenFoamCaseGenerator.generateBlockMeshDict({ geometry: 'sphere' }), /geometry/);
});

// ---------------------------------------------------------------------------
// CalculiX case generator
// ---------------------------------------------------------------------------

test('CalculiX: *NODE and *ELEMENT counts and type match input; *ELASTIC carries E and nu', () => {
  const nodes = [];
  for (let i = 1; i <= 20; i++) {
    nodes.push([i, (i - 1) % 4, Math.floor((i - 1) / 4) % 5, Math.floor((i - 1) / 20)]);
  }
  const elements = [[1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]];

  const deck = CalculixCaseGenerator.generateInputDeck({
    heading: 'C3D20 hexahedral verification',
    nodes,
    elements,
    elementType: 'C3D20',
    materialName: 'AL7075',
    youngsModulus_MPa: 71700,
    poissonsRatio: 0.33,
    yieldStress_MPa: 503,
    nodeSets: {
      NFIX: [1, 2, 3, 4],
      NLOAD: [19, 20]
    },
    boundaryConditions: [{ set: 'NFIX', dofs: [1, 3], value: 0 }],
    appliedLoads: [{ set: 'NLOAD', dof: 2, magnitude: -1000 }],
    isNonLinearGeom: true
  });

  const parsed = CalculixCaseGenerator.parseDeck(deck);
  assert.equal(parsed.nodes.length, nodes.length, '*NODE count');
  assert.equal(parsed.elements.length, elements.length, '*ELEMENT count');
  assert.equal(parsed.elementType, 'C3D20', 'element type');
  assert.equal(parsed.elastic, '71700, 0.33', '*ELASTIC E and nu');
  assert.ok(parsed.plastic.includes('503, 0.0'), '*PLASTIC yield point');
  assert.equal(parsed.step, '*STEP, NLGEOM');
  assert.equal(parsed.hasEndStep, true, '*END STEP');
  assert.ok(deck.includes('*STATIC'), '*STATIC step present');
});

test('CalculiX: boundary and cload blocks reference existing node sets', () => {
  const deck = CalculixCaseGenerator.generateInputDeck({
    nodes: [
      [1, 0, 0, 0],
      [2, 1, 0, 0],
      [3, 1, 1, 0],
      [4, 0, 1, 0],
      [5, 0, 0, 1],
      [6, 1, 0, 1],
      [7, 1, 1, 1],
      [8, 0, 1, 1]
    ],
    elements: [[1, 1, 2, 3, 4, 5, 6, 7, 8]],
    elementType: 'C3D8',
    nodeSets: { NFIX: [1, 2, 3, 4], NLOAD: [7, 8] },
    boundaryConditions: [{ set: 'NFIX', dofs: [1, 3], value: 0 }],
    appliedLoads: [{ set: 'NLOAD', dof: 2, magnitude: -5000 }]
  });

  assert.ok(deck.includes('*NSET, NSET=NFIX'), 'NSET declaration');
  assert.ok(deck.includes('NFIX, 1, 3, 0'), 'boundary references NFIX');
  assert.ok(deck.includes('NLOAD, 2, -5000'), 'cload references NLOAD');

  const parsed = CalculixCaseGenerator.parseDeck(deck);
  for (const line of parsed.boundary) {
    const setName = line.split(',')[0].trim();
    assert.ok(parsed.nodeSets[setName], `boundary references declared set ${setName}`);
  }
  for (const line of parsed.cload) {
    const setName = line.split(',')[0].trim();
    assert.ok(parsed.nodeSets[setName], `cload references declared set ${setName}`);
  }
});

test('CalculiX: fail-closed on missing material props and unknown node-set references', () => {
  const nodes = [
    [1, 0, 0, 0],
    [2, 1, 0, 0],
    [3, 1, 1, 0],
    [4, 0, 1, 0],
    [5, 0, 0, 1],
    [6, 1, 0, 1],
    [7, 1, 1, 1],
    [8, 0, 1, 1]
  ];
  const elements = [[1, 1, 2, 3, 4, 5, 6, 7, 8]];
  assert.throws(
    () => CalculixCaseGenerator.generateInputDeck({ nodes, elements, youngsModulus_MPa: null }),
    /youngsModulus_MPa/
  );
  assert.throws(
    () => CalculixCaseGenerator.generateInputDeck({ nodes, elements, poissonsRatio: 0.6 }),
    /poissonsRatio/
  );
  assert.throws(
    () => CalculixCaseGenerator.generateInputDeck({ nodes, elements, elementType: 'C3D4' }),
    /element type/
  );
  assert.throws(
    () =>
      CalculixCaseGenerator.generateInputDeck({
        nodes,
        elements,
        nodeSets: { NFIX: [1, 2] },
        boundaryConditions: [{ set: 'GHOST', dofs: [1, 3], value: 0 }]
      }),
    /GHOST/
  );
  assert.throws(
    () =>
      CalculixCaseGenerator.generateInputDeck({
        nodes,
        elements,
        nodeSets: { NFIX: [1, 2] },
        appliedLoads: [{ set: 'GHOST', dof: 2, magnitude: -1 }]
      }),
    /GHOST/
  );
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

test('Determinism: identical runs produce identical outputs', () => {
  const spec = {
    jobName: 'det_job',
    solverType: 'openfoam',
    nodes: 2,
    ntasksPerNode: 4,
    cores: 8,
    walltime: '01:00:00',
    executable: 'interFoam',
    env: { A: '1' }
  };
  const g1 = new SlurmClusterGateway();
  const g2 = new SlurmClusterGateway();
  assert.equal(g1.generateBatchScript(spec), g2.generateBatchScript(spec), 'slurm script determinism');
  assert.equal(g1.dryRunSubmit(spec).script, g2.dryRunSubmit(spec).script, 'dry-run determinism');

  const treeOptions = { controlDict: { application: 'rhoCentralFoam', endTime: 0.2, deltaT: 1e-5 } };
  assert.deepEqual(
    OpenFoamCaseGenerator.generateCaseTree(treeOptions),
    OpenFoamCaseGenerator.generateCaseTree(treeOptions),
    'openfoam case-tree determinism'
  );

  const ccxOptions = {
    nodes: [
      [1, 0, 0, 0],
      [2, 1, 0, 0],
      [3, 1, 1, 0],
      [4, 0, 1, 0],
      [5, 0, 0, 1],
      [6, 1, 0, 1],
      [7, 1, 1, 1],
      [8, 0, 1, 1]
    ],
    elements: [[1, 1, 2, 3, 4, 5, 6, 7, 8]],
    elementType: 'C3D8',
    nodeSets: { NFIX: [1, 2, 3, 4] },
    boundaryConditions: [{ set: 'NFIX', dofs: [1, 2, 3], value: 0 }]
  };
  assert.equal(
    CalculixCaseGenerator.generateInputDeck(ccxOptions),
    CalculixCaseGenerator.generateInputDeck(ccxOptions),
    'calculix deck determinism'
  );
});
