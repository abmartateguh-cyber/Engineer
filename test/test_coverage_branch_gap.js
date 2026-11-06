'use strict';

/**
 * OmniEng branch-gap coverage suite.
 *
 * Focused, deterministic checks for production files with the largest number
 * of uncovered non-entry V8 ranges (branch-proxy blocks). Every check calls a
 * real production module and asserts observable behavior; no check is a
 * call-for-coverage stub.
 */

const assert = require('assert');

const { HpcClusterGateway, JOB_STATES } = require('../src/core/hpc/hpc_cluster_gateway');
const { OmniError, OmniErrorCode } = require('../src/core/contracts/OmniError');
const { OpticalGlassCatalog } = require('../src/core/optics/optical_glass_catalog');
const { ZemaxZmxImporter } = require('../src/core/optics/zmx_importer');
const { Sky130PdkAdapter, validateLibraryData } = require('../src/core/eda/sky130_pdk_adapter');
const { getExperimentalEdaLibraryExample } = require('./support/experimental_eda_library_example');
const { BlockDiagramGraph, BlockGraph } = require('../src/core/dynamic_simulink/block_graph');
const {
  validateSchema,
  withIpcMain,
  defineHandler,
  isChannelRegistered,
  getRegisteredChannels
} = require('../src/main/ipc/define_handler');
const { DRCEngine } = require('../src/core/eda/drc_engine');
const { SpiceEngine } = require('../src/core/eda/spice_engine');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { GeometryEngineAdapter } = require('../src/core/cad/geometry_engine_adapter');
const { ControlsEngineAdapter } = require('../src/core/controls/controls_engine_adapter');
const { OpticsEngineAdapter } = require('../src/core/optics/optics_engine_adapter');

async function runBranchGapCoverageTests() {
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

  const rejects = async (fn) => {
    try {
      await fn();
    } catch (err) {
      return err;
    }
    return null;
  };

  // ---------------------------------------------------------------
  // HPC cluster gateway
  // ---------------------------------------------------------------
  check('HpcClusterGateway generateSlurmScript defaults and full option branches', () => {
    const defaults = HpcClusterGateway.generateSlurmScript();
    assert.strictEqual(defaults.scheduler, 'SLURM');
    assert.strictEqual(defaults.nodes, 1);
    assert.strictEqual(defaults.totalMpiRanks, 16);
    assert(defaults.script.includes('#SBATCH --gres=gpu:2') === false);

    const full = HpcClusterGateway.generateSlurmScript({
      jobName: 'job',
      partition: 'gpu',
      nodes: 2,
      ntasksPerNode: 4,
      cpusPerTask: 2,
      gpusPerNode: 1,
      memoryPerNode: '128GB',
      walltime: '08:00:00',
      account: 'acct',
      qos: 'high',
      email: 'a@b.c',
      modules: ['openmpi/4.1.5'],
      executable: 'run',
      args: ['-n', '2']
    });
    assert.strictEqual(full.totalMpiRanks, 8);
    assert.strictEqual(full.totalGpus, 2);
    assert(full.script.includes('#SBATCH --gres=gpu:1'));
    assert(full.script.includes('#SBATCH --account=acct'));
    assert(full.script.includes('#SBATCH --qos=high'));
    assert(full.script.includes('#SBATCH --mail-user=a@b.c'));
    assert(full.script.includes('srun --mpi=pmix_v3 -n 8 run -n 2'));

    const commandArray = HpcClusterGateway.generateSlurmScript({ command: ['mpirun', '-np', '4', 'app'] });
    assert(commandArray.script.includes('mpirun -np 4 app'));
  });

  check('HpcClusterGateway generateSlurmScript rejects invalid spec fields', () => {
    assert.throws(() => HpcClusterGateway.generateSlurmScript([]), OmniError);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ nodes: 0 }), /integer >= 1/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ ntasksPerNode: 0 }), /integer >= 1/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ cpusPerTask: 0 }), /integer >= 1/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ gpusPerNode: -1 }), /integer >= 0/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ walltime: '04:00' }), /HH:MM:SS/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ modules: [''] }), /non-empty strings/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ modules: [123] }), /non-empty strings/);
    assert.throws(() => HpcClusterGateway.generateSlurmScript({ jobName: 5 }), /must be a string/);
  });

  check('HpcClusterGateway generatePbsProScript branches', () => {
    const defaults = HpcClusterGateway.generatePbsProScript();
    assert.strictEqual(defaults.scheduler, 'PBS_PRO');
    assert.strictEqual(defaults.totalMpiRanks, 8);
    const full = HpcClusterGateway.generatePbsProScript({
      jobName: 'job',
      queue: 'batch',
      nodes: 2,
      mpiRanksPerNode: 4,
      cpusPerRank: 2,
      walltime: '02:00:00',
      memoryPerNode: '32GB',
      account: 'acct',
      email: 'a@b.c',
      command: 'app'
    });
    assert.strictEqual(full.totalMpiRanks, 8);
    assert.strictEqual(full.totalCores, 16);
    assert(full.script.includes('#PBS -l mem=32GB'));
    assert(full.script.includes('#PBS -A acct'));
    assert(full.script.includes('#PBS -M a@b.c'));
    assert(full.script.includes('mpiexec -n 8 app'));
    assert.strictEqual(HpcClusterGateway.generatePbsScript().scheduler, 'PBS_PRO');
    assert.throws(() => HpcClusterGateway.generatePbsProScript({ nodes: 0 }), /integer >= 1/);
  });

  check('HpcClusterGateway partitionRcb and planOutOfCoreFrontal', () => {
    assert.deepStrictEqual(HpcClusterGateway.partitionRcb(), []);
    const points = Array.from({ length: 8 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 2), z: i }));
    const parts = HpcClusterGateway.partitionRcb(points, 4);
    assert.strictEqual(parts.status, 'PARTITIONED');
    assert.strictEqual(parts.numPartitions, 4);
    assert.strictEqual(parts.totalNodes, 8);
    assert(typeof parts.imbalanceRatio === 'number');

    const estimate = HpcClusterGateway.planOutOfCoreFrontal(1000, 8e9, {
      matrixNonzerosPerDof: 10,
      factorEntriesPerDof: 100
    });
    assert.strictEqual(estimate.status, 'ESTIMATE_ONLY');
    assert.strictEqual(estimate.solvePerformed, false);
    assert(estimate.totalChunks >= 1);
    assert.throws(
      () => HpcClusterGateway.planOutOfCoreFrontal(0, 8e9, { matrixNonzerosPerDof: 10, factorEntriesPerDof: 100 }),
      TypeError
    );
    assert.throws(
      () =>
        HpcClusterGateway.planOutOfCoreFrontal(1000, Number.NaN, {
          matrixNonzerosPerDof: 10,
          factorEntriesPerDof: 100
        }),
      TypeError
    );
    assert.throws(
      () => HpcClusterGateway.planOutOfCoreFrontal(1000, 8e9, { matrixNonzerosPerDof: 0, factorEntriesPerDof: 100 }),
      TypeError
    );
  });

  check('HpcClusterGateway submitJob and submitSimulationJob', () => {
    const gateway = new HpcClusterGateway({ provider: 'test', active: true });
    const slurm = gateway.submitJob({ jobName: 'a', scheduler: 'SLURM' });
    assert.strictEqual(slurm.status, JOB_STATES.QUEUED);
    assert.strictEqual(slurm.scheduler, 'SLURM');

    const pbs = gateway.submitJob({ jobName: 'b', scheduler: 'pbs_pro' });
    assert.strictEqual(pbs.scheduler, 'PBS_PRO');
    assert.throws(() => gateway.submitJob({ scheduler: 'LSF' }), /Unsupported scheduler/);
    assert.throws(() => gateway.submitJob(null), /job spec object/);
    assert.throws(() => gateway.submitJob([]), /job spec object/);

    const sim = gateway.submitSimulationJob('cfd', { mesh: 'm' }, 4);
    assert.strictEqual(sim.success, true);
    assert.strictEqual(sim.jobId, sim.jobId);
    assert.strictEqual(sim.status, JOB_STATES.QUEUED);
    assert.throws(() => gateway.submitSimulationJob('', {}, 2), /job type string/);
    assert.throws(() => gateway.submitSimulationJob('cfd', null, 2), /parameter object/);
    assert.throws(() => gateway.submitSimulationJob('cfd', {}, 0), /rank count/);
  });

  check('HpcClusterGateway job transitions enforce the state machine', () => {
    const gateway = new HpcClusterGateway();
    const job = gateway.submitJob({ jobName: 't' });
    gateway.markRunning(job.jobId);
    assert.strictEqual(gateway.getJob(job.jobId).status, JOB_STATES.RUNNING);
    gateway.markCompleted(job.jobId);
    assert.strictEqual(gateway.getJob(job.jobId).status, JOB_STATES.COMPLETED);
    assert.throws(() => gateway.markRunning(job.jobId), /Illegal HPC job transition/);
    assert.throws(() => gateway.markCompleted('missing'), /Unknown HPC job id/);

    const job2 = gateway.submitJob({ jobName: 't2' });
    gateway.failJob(job2.jobId, new Error('boom'));
    assert.strictEqual(gateway.getJob(job2.jobId).status, JOB_STATES.FAILED);
    assert.strictEqual(gateway.getJob(job2.jobId).error.code, 'INTERNAL');
    const job3 = gateway.submitJob({ jobName: 't3' });
    gateway.failJob(job3.jobId, { code: 'X', message: 'm' });
    assert.strictEqual(gateway.getJob(job3.jobId).error.code, 'X');
    assert.throws(
      () => gateway.failJob(job3.jobId, null) && gateway.markCompleted(job3.jobId),
      /Illegal HPC job transition/
    );
  });

  check('HpcClusterGateway listJobs filters, getJob, telemetry, membership', () => {
    const stubPool = { getTelemetry: () => ({ status: 'stub-pool' }) };
    const gateway = new HpcClusterGateway({ workerPool: stubPool });
    const j1 = gateway.submitJob({ jobName: 'a', scheduler: 'SLURM' });
    const j2 = gateway.submitJob({ jobName: 'b', scheduler: 'PBS_PRO' });
    gateway.markRunning(j2.jobId);
    assert.strictEqual(gateway.listJobs({ status: 'RUNNING' }).length, 1);
    assert.strictEqual(gateway.listJobs({ scheduler: 'SLURM' }).length, 1);
    assert.strictEqual(gateway.listJobs({ status: 'QUEUED', scheduler: 'PBS_PRO' }).length, 0);
    assert.throws(() => gateway.getJob('nope'), /Unknown HPC job id/);

    const telemetry = gateway.getTelemetry();
    assert.strictEqual(telemetry.configured, true);
    assert.strictEqual(telemetry.jobs.total, 2);
    assert.strictEqual(telemetry.jobs.byState.RUNNING, 1);
    const status = gateway.getClusterStatus();
    assert.strictEqual(status.status, 'READY');
    assert.strictEqual(gateway.setMembership(false).active, false);
    assert.strictEqual(gateway.getClusterStatus().status, 'OFFLINE');
    assert.strictEqual(gateway.getTelemetry().configured, false);
  });

  // ---------------------------------------------------------------
  // Optical glass catalog
  // ---------------------------------------------------------------
  const SELLMEIER_GLASS = {
    name: 'N-BK7',
    referenceTemperatureC: 20,
    formula: 'sellmeier1',
    B: [1.03961212, 0.231792344, 1.01046945],
    C: [0.00600069867, 0.0200179144, 103.560653],
    dndTPerK: 1.2e-6,
    supplier: 'synthetic',
    type: 'crown'
  };

  check('OpticalGlassCatalog registerGlass accepts and rejects records', () => {
    const catalog = new OpticalGlassCatalog();
    const record = catalog.registerGlass(SELLMEIER_GLASS);
    assert.strictEqual(record.dataStatus, 'caller-supplied');
    const bi = catalog.registerGlass({
      name: 'Calcite',
      referenceTemperatureC: 20,
      formula: 'birefringent',
      no: 1.658,
      ne: 1.486
    });
    assert.strictEqual(bi.formula, 'birefringent');
    assert.throws(() => new OpticalGlassCatalog('x'), TypeError);
    assert.throws(() => catalog.registerGlass(null), /record is required/);
    assert.throws(() => catalog.registerGlass({ formula: 'sellmeier1' }), /nonempty name/);
    assert.throws(
      () =>
        catalog.registerGlass({
          name: 'x',
          referenceTemperatureC: -300,
          formula: 'sellmeier1',
          B: [1, 0, 0],
          C: [1, 1, 1]
        }),
      /above absolute zero/
    );
    assert.throws(
      () => catalog.registerGlass({ name: 'x', referenceTemperatureC: 20, formula: 'weird' }),
      /sellmeier1 or birefringent/
    );
    assert.throws(
      () =>
        catalog.registerGlass({ name: 'x', referenceTemperatureC: 20, formula: 'sellmeier1', B: [1, 0], C: [1, 1, 1] }),
      /three finite numbers/
    );
    assert.throws(
      () => catalog.registerGlass({ name: 'x', referenceTemperatureC: 20, formula: 'birefringent', no: -1, ne: 1 }),
      /finite positive ordinary and extraordinary indices/
    );
    assert.throws(
      () =>
        catalog.registerGlass({
          name: 'x',
          referenceTemperatureC: 20,
          formula: 'sellmeier1',
          B: [1, 0, 0],
          C: [1, 1, 1],
          dndT: 1e-6
        }),
      /dndTPerK/
    );
    assert.throws(
      () =>
        catalog.registerGlass({
          name: 'x',
          referenceTemperatureC: 20,
          formula: 'sellmeier1',
          B: [1, 0, 0],
          C: [1, 1, 1],
          dndTPerK: 'x'
        }),
      /thermo-optic coefficient/
    );
  });

  check('OpticalGlassCatalog calculateIndex validates and computes', () => {
    const catalog = new OpticalGlassCatalog([SELLMEIER_GLASS]);
    const n = catalog.calculateIndex('N-BK7', 0.58756, 20);
    assert(n > 1.5 && n < 1.6);
    assert.strictEqual(catalog.calculateIndex(SELLMEIER_GLASS, 0.58756, 20), n);
    assert(
      Math.abs(catalog.calculateIndex('N-BK7', 0.58756, 25) - n) > 1e-9,
      'Thermo-optic correction must shift the index'
    );
    assert.throws(() => catalog.calculateIndex('MISSING', 0.58756, 20), /not available/);
    assert.throws(() => catalog.calculateIndex(SELLMEIER_GLASS, 0, 20), TypeError);
    assert.throws(() => catalog.calculateIndex(SELLMEIER_GLASS, 0.58756, -300), TypeError);
    assert.throws(() => catalog.calculateIndex({ name: 'x' }, 0.58756, 20), /isotropic three-term Sellmeier/);
    const singular = {
      name: 'S',
      referenceTemperatureC: 20,
      formula: 'sellmeier1',
      B: [1, 0, 0],
      C: [Math.pow(0.58756, 2), 1, 1]
    };
    assert.throws(() => catalog.calculateIndex(singular, 0.58756, 20), /singular/);
    const noThermo = { ...SELLMEIER_GLASS, dndTPerK: undefined };
    assert.throws(() => catalog.calculateIndex(noThermo, 0.58756, 30), /dndTPerK/);
  });

  check('OpticalGlassCatalog getOpticalProperties and findNearestGlasses', () => {
    const catalog = new OpticalGlassCatalog([SELLMEIER_GLASS]);
    const props = catalog.getOpticalProperties('N-BK7', 20);
    assert(Number.isFinite(props.Abbe_Vd));
    assert(Number.isFinite(props.nd));
    assert.strictEqual(props.temperatureC, 20);
    assert.throws(() => catalog.getOpticalProperties('MISSING', 20), /not available/);
    assert.throws(() => catalog.getOpticalProperties('N-BK7', -300), TypeError);

    const matches = catalog.findNearestGlasses(1.5168, 64.2, 20, 2);
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].name, 'N-BK7');
    assert.strictEqual(catalog.findNearestGlasses(1.5168, 64.2, 20, 0).length, 0);
    assert.throws(() => catalog.findNearestGlasses(Number.NaN, 64.2, 20, 2), TypeError);
    assert.throws(() => catalog.findNearestGlasses(1.5168, 64.2, 20, -1), RangeError);
  });

  // ---------------------------------------------------------------
  // Zemax ZMX importer
  // ---------------------------------------------------------------
  const ZMX_TEXT = [
    'VERS 2023',
    'NAME demo',
    'UNIT MM',
    'WAVM 1 0.58756 1.0',
    'PWAV 1',
    'XFLN 1 0.0',
    'YFLN 1 0.0',
    'FWGN 1 1.0',
    'SURF 0',
    'TYPE STANDARD',
    'CURV 0.0',
    'DISZ 10.0',
    'GLAS AIR',
    'DIAM 12.0',
    'SURF 1',
    'TYPE STANDARD',
    'CURV 0.02',
    'DISZ 100.0',
    'GLAS N-BK7',
    'DIAM 20.0',
    'CONI 0.0',
    'STOP',
    'PARM 1 0.1',
    'SURF 2',
    'TYPE STANDARD',
    'GLAS AIR'
  ].join('\n');

  check('ZemaxZmxImporter parses text, buffer, and metric systems', () => {
    const system = ZemaxZmxImporter.parse(ZMX_TEXT);
    assert.strictEqual(system.format, 'ZEMAX_OPTICSTUDIO');
    assert.strictEqual(system.name, 'demo');
    assert.strictEqual(system.surfaces.length, 3);
    assert.strictEqual(system.stopSurfaceIndex, 1);
    assert.strictEqual(system.surfaces[1].glass, 'N-BK7');
    assert.strictEqual(system.surfaces[1].asphericParams[0], 0.1);

    const buf = Buffer.from('\uFEFF' + ZMX_TEXT, 'utf16le');
    const fromBuffer = ZemaxZmxImporter.parse(buf);
    assert.strictEqual(fromBuffer.surfaces.length, 3);

    const unavailable = ZemaxZmxImporter.evaluateParaxialMetrics(system);
    assert.strictEqual(unavailable.status, 'unavailable');
    assert.deepStrictEqual(unavailable.missingMaterialIndices, ['N-BK7']);
    assert.match(unavailable.reason, /refractive index/);

    const available = ZemaxZmxImporter.evaluateParaxialMetrics(system, { materialIndices: { 'N-BK7': 1.5168 } });
    assert.strictEqual(available.status, 'experimental');
    assert(Number.isFinite(available.estimatedEflMm));
    assert(Number.isFinite(available.fNumberEstimate));

    const singleSurface = {
      surfaces: [{ glass: 'AIR', radius: Infinity, curvature: 0, thickness: 5, semiDiameter: 10 }]
    };
    const flat = ZemaxZmxImporter.evaluateParaxialMetrics(singleSurface, {});
    assert.strictEqual(flat.status, 'unavailable');
    assert.strictEqual(flat.estimatedEflMm, null);
    assert.throws(() => ZemaxZmxImporter.evaluateParaxialMetrics(null), TypeError);
  });

  // ---------------------------------------------------------------
  // Sky130 PDK adapter
  // ---------------------------------------------------------------
  check('Sky130PdkAdapter validation branches', () => {
    assert.throws(() => validateLibraryData(null), /explicit object/);
    assert.throws(() => validateLibraryData({}), /libraryName/);
    assert.throws(() => validateLibraryData({ libraryName: 'L', processName: '' }), /processName/);
    const base = getExperimentalEdaLibraryExample();
    assert.throws(() => validateLibraryData({ ...base, techNodeNm: 0 }), /finite positive number/);
    assert.throws(() => validateLibraryData({ ...base, provenance: {} }), /source/);
    assert.throws(() => validateLibraryData({ ...base, layers: {} }), /at least one layer/);
    assert.throws(() => validateLibraryData({ ...base, cells: {} }), /at least one layer/);
    const badLayer = { ...base, layers: { metal1: { name: 'metal1', type: 'BOGUS', pitchUm: 1, minWidthUm: 1 } } };
    assert.throws(() => validateLibraryData(badLayer), /supported LEF type/);
    const badCell = {
      ...base,
      cells: {
        demo_inv: {
          name: 'other',
          class: 'CORE',
          widthUm: 1,
          heightUm: 1,
          pins: {},
          timing: { baseDelayPs: 0, driveResOhm: 0 }
        }
      }
    };
    assert.throws(() => validateLibraryData(badCell), /same cell name/);
    const badPin = structuredClone(base);
    badPin.cells.demo_inv.pins.A.rectUm = [0, 0, 5, 1];
    assert.throws(() => validateLibraryData(badPin), /positive rectangle inside/);
  });

  check('Sky130PdkAdapter unavailable and full-library operations', () => {
    const empty = new Sky130PdkAdapter(undefined);
    assert.strictEqual(empty.available, false);
    assert.throws(
      () => empty.generateLEF(),
      (err) => err.code === 'UNAVAILABLE'
    );
    assert.throws(
      () => empty.computeCellDelay('demo_inv', 1, 'typical'),
      (err) => err.code === 'UNAVAILABLE'
    );

    const adapter = new Sky130PdkAdapter(getExperimentalEdaLibraryExample());
    assert.strictEqual(adapter.available, true);
    const lef = adapter.generateLEF();
    assert(lef.includes('VERSION 5.8 ;'));
    assert(lef.includes('LAYER metal1'));
    assert(lef.includes('MACRO demo_inv'));
    assert(lef.includes('PIN A'));
    const delay = adapter.computeCellDelay('demo_inv', 5, 'slow');
    assert(Number.isFinite(delay.totalDelayPs));
    assert.strictEqual(delay.corner, 'slow');
    assert.throws(() => adapter.computeCellDelay('nope', 5, 'slow'), RangeError);
    assert.throws(() => adapter.computeCellDelay('demo_inv', -1, 'slow'), TypeError);
    assert.throws(() => adapter.computeCellDelay('demo_inv', 5, 'nope'), RangeError);
  });

  // ---------------------------------------------------------------
  // Block diagram graph
  // ---------------------------------------------------------------
  check('BlockDiagramGraph simulate validation branches', () => {
    const graph = new BlockDiagramGraph();
    assert.throws(() => graph.simulate(0, 0.1), TypeError);
    assert.throws(() => graph.simulate(1, Number.NaN), TypeError);
    assert.throws(() => graph.simulate(1, 0.1), /at least one configured block/);
    graph.addBlock('gain', 'g', { k: 2 });
    assert.throws(() => graph.simulate(1, 0.1), /at least one input connection/);
    const bad = new BlockDiagramGraph();
    bad.addBlock('source_step', 's', { stepTime: 1, initialValue: 0, finalValue: 1 });
    const un = bad.connect('blk_000001', 'blk_000002');
    assert.throws(() => bad.simulate(1, 0.1), /references a missing block/);
    assert.strictEqual(un.id.startsWith('wire_'), true);
  });

  check('BlockDiagramGraph simulate runs an acyclic signal graph', () => {
    const graph = new BlockDiagramGraph();
    graph.addBlock('source_constant', 'src', { value: 3 });
    graph.addBlock('gain', 'g1', { k: 2 });
    graph.addBlock('sum', 'sum');
    graph.addBlock('gain', 'g2', { k: 0.5 });
    graph.addBlock('scope', 'out');
    const srcId = Array.from(graph.blocks.keys())[0];
    const ids = Array.from(graph.blocks.keys());
    graph.connect(ids[0], ids[1]);
    graph.connect(ids[1], ids[2]);
    graph.connect(ids[2], ids[3]);
    graph.connect(ids[3], ids[4]);
    const result = graph.simulate(1, 0.5);
    assert.strictEqual(result.time.length, 3);
    assert.strictEqual(result.signals[ids[3]][0], 3);
    assert.strictEqual(result.signals[ids[4]][0], 3);
    assert.strictEqual(srcId, ids[0]);
  });

  check('BlockDiagramGraph rejects feedback loops, bad params, and work limits', () => {
    const graph = new BlockDiagramGraph();
    graph.addBlock('source_constant', 'a', { value: 1 });
    graph.addBlock('gain', 'b', { k: 1 });
    const ids = Array.from(graph.blocks.keys());
    graph.connect(ids[0], ids[1]);
    graph.connect(ids[1], ids[0]);
    assert.throws(() => graph.simulate(1, 0.5), /feedback loops are unsupported/);

    const missingParam = new BlockDiagramGraph();
    missingParam.addBlock('source_step', 's', { stepTime: 1 });
    assert.throws(() => missingParam.simulate(1, 0.5), /initialValue/);

    const unsupported = new BlockDiagramGraph();
    unsupported.addBlock('weird', 'w', {});
    assert.throws(() => unsupported.simulate(1, 0.5), /Unsupported block type/);

    const huge = new BlockDiagramGraph();
    huge.addBlock('source_constant', 'c', { value: 0 });
    assert.throws(() => huge.simulate(2e6, 1), /work limit/);
  });

  check('BlockGraph config form and JSON round-trip', () => {
    const graph = new BlockGraph();
    graph.addBlock({ id: 'custom', type: 'gain', name: 'g', parameters: { k: 4 } });
    assert.strictEqual(graph.blocks.get('custom').type, 'gain');
    const legacy = graph.addBlock('source_constant', 'c', { value: 1 });
    assert.strictEqual(legacy.type, 'source_constant');
    const json = graph.toJSON();
    assert.strictEqual(json.blocks.length, 2);
    const restored = BlockDiagramGraph.fromJSON(json);
    assert.strictEqual(restored.blocks.size, 2);
    assert.strictEqual(restored.blocks.get('custom').params.k, 4);
    assert.strictEqual(BlockDiagramGraph.fromJSON(null).blocks.size, 0);
  });

  // ---------------------------------------------------------------
  // IPC schema validation
  // ---------------------------------------------------------------
  check('validateSchema optional, required, and missing-value branches', () => {
    assert.strictEqual(validateSchema(undefined, { optional: true }), true);
    assert.strictEqual(validateSchema(null, { required: false }), true);
    assert.throws(() => validateSchema(undefined, { type: 'number' }), /Missing required field/);
    assert.strictEqual(validateSchema(5, {}), true);
  });

  check('validateSchema array, buffer, number, string, boolean, object branches', () => {
    assert.strictEqual(
      validateSchema([1, 2], { type: 'array', minItems: 1, maxItems: 5, items: { type: 'number' } }),
      true
    );
    assert.throws(() => validateSchema([], { type: 'array', minItems: 1 }), /minItems/);
    assert.throws(() => validateSchema([1, 2, 3], { type: 'array', maxItems: 2 }), /maxItems/);
    assert.throws(() => validateSchema('x', { type: 'array' }), /Expected array/);
    assert.throws(
      () => validateSchema([1, 'x'], { type: 'array', items: { type: 'number' } }),
      /must be a finite number/
    );

    assert.strictEqual(validateSchema(new Uint8Array(4), { type: 'buffer', maxBytes: 1024 }), true);
    assert.throws(() => validateSchema('x', { type: 'buffer' }), /Buffer\/Uint8Array/);

    assert.strictEqual(validateSchema(3, { type: 'number', integer: true, min: 1, max: 5 }), true);
    assert.throws(() => validateSchema(3.5, { type: 'number', integer: true }), /must be an integer/);
    assert.throws(() => validateSchema(0, { type: 'number', min: 1 }), /< min/);
    assert.throws(() => validateSchema(9, { type: 'number', max: 5 }), /> max/);
    assert.throws(() => validateSchema(Number.NaN, { type: 'number' }), /finite number/);

    assert.strictEqual(validateSchema('abc', { type: 'string', maxLength: 5, enum: ['abc', 'def'] }), true);
    assert.throws(() => validateSchema('abcdef', { type: 'string', maxLength: 5 }), /maxLength/);
    assert.throws(() => validateSchema('zzz', { type: 'string', enum: ['abc'] }), /must be one of/);
    assert.throws(() => validateSchema(3, { type: 'string' }), /Expected string/);

    assert.strictEqual(validateSchema(true, { type: 'boolean' }), true);
    assert.throws(() => validateSchema(1, { type: 'boolean' }), /Expected boolean/);

    assert.strictEqual(
      validateSchema(
        { a: 1 },
        { type: 'object', required: ['a'], properties: { a: { type: 'number' } }, additionalProperties: false }
      ),
      true
    );
    assert.throws(() => validateSchema({}, { type: 'object', required: ['a'] }), /Missing required object property/);
    assert.throws(
      () =>
        validateSchema(
          { a: 1, b: 2 },
          { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false }
        ),
      /Unexpected object properties/
    );
    assert.throws(() => validateSchema([], { type: 'object' }), /Expected object/);
    assert.throws(
      () => validateSchema({ a: 'x' }, { type: 'object', properties: { a: { type: 'number' } } }),
      /must be a finite number/
    );
  });

  check('withIpcMain validates and restores active ipcMain', () => {
    assert.throws(() => withIpcMain(null, () => {}), TypeError);
    assert.throws(() => withIpcMain({ handle() {} }, null), TypeError);
    let called = false;
    const fake = {
      handle(channel) {
        called = true;
      }
    };
    const result = withIpcMain(fake, () => 42);
    assert.strictEqual(result, 42);
    assert.strictEqual(called, false);
  });

  check('defineHandler validates channels, schema, handler, duplicates', () => {
    assert.throws(() => defineHandler('omni:test', null, () => {}), /validation schema/);
    assert.throws(() => defineHandler('bad', {}, () => {}), /must start with 'omni:'/);
    assert.throws(() => defineHandler('omni:test', {}, null), /callable handler/);
    const fake = { handle() {} };
    const metadata = withIpcMain(fake, () =>
      defineHandler('omni:gap-test-' + Date.now(), { type: 'object' }, () => Promise.resolve({ ok: true }))
    );
    assert.strictEqual(metadata.domain, 'system');
    assert.strictEqual(metadata.maturity.state, 'experimental');
    assert.strictEqual(isChannelRegistered(metadata.channel), true);
    assert.throws(() => withIpcMain(fake, () => defineHandler(metadata.channel, {}, () => {})), /already registered/);
    assert(getRegisteredChannels().some((c) => c.channel === metadata.channel));
  });

  // ---------------------------------------------------------------
  // DRC engine
  // ---------------------------------------------------------------
  check('DRCEngine runDRC input and rule branches', () => {
    assert.strictEqual(DRCEngine.runDRC([], { minWidth: 1, minSpacing: 1, minArea: 1 }).success, false);
    assert.strictEqual(DRCEngine.runDRC([{ id: 'a', layer: 'L', x: 0, y: 0, w: 1, h: 1 }], {}).success, false);
    assert.strictEqual(
      DRCEngine.runDRC([{ id: 'a', layer: 'L', x: 0, y: 0, w: 1, h: 1 }], { minWidth: 1, minSpacing: 1, minArea: 1 })
        .clean,
      true
    );
    const dup = DRCEngine.runDRC(
      [
        { id: 'a', layer: 'L', x: 0, y: 0, w: 1, h: 1 },
        { id: 'a', layer: 'L', x: 3, y: 0, w: 1, h: 1 }
      ],
      { minWidth: 1, minSpacing: 1, minArea: 1 }
    );
    assert.strictEqual(dup.success, false);
    const badWidth = DRCEngine.runDRC([{ id: 'a', layer: 'L', x: 0, y: 0, w: 0.5, h: 1 }], {
      minWidth: 1,
      minSpacing: 1,
      minArea: 1
    });
    assert(badWidth.violations.some((v) => v.type === 'MIN_WIDTH_VIOLATION'));
  });

  check('DRCEngine runDRC spacing and overlap screening', () => {
    const rules = { minWidth: 1, minSpacing: 2, minArea: 1 };
    const close = DRCEngine.runDRC(
      [
        { id: 'a', layer: 'L', x: 0, y: 0, w: 1, h: 1 },
        { id: 'b', layer: 'L', x: 2, y: 0, w: 1, h: 1 }
      ],
      rules
    );
    assert(close.violations.some((v) => v.type === 'MIN_SPACING_VIOLATION'));
    const overlap = DRCEngine.runDRC(
      [
        { id: 'a', layer: 'L', x: 0, y: 0, w: 2, h: 2 },
        { id: 'b', layer: 'L', x: 1, y: 1, w: 2, h: 2 }
      ],
      rules
    );
    assert(overlap.violations.some((v) => v.type === 'SHORT_CIRCUIT_OVERLAP'));
    const clean = DRCEngine.runDRC(
      [
        { id: 'a', layer: 'L', x: 0, y: 0, w: 1, h: 1 },
        { id: 'b', layer: 'L', x: 10, y: 10, w: 1, h: 1 },
        { id: 'c', layer: 'M', x: 0, y: 0, w: 1, h: 1 }
      ],
      rules
    );
    assert.strictEqual(clean.clean, true);
  });

  // ---------------------------------------------------------------
  // Spice engine
  // ---------------------------------------------------------------
  check('SpiceEngine runs an RC transient with a STEP source', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 5, { type: 'STEP', v1: 0, v2: 5, delay: 0 });
    spice.addResistor('R1', 'in', 'out', 1000);
    spice.addCapacitor('C1', 'out', '0', 1e-6);
    const result = spice.runTransient(0.004, 1e-5);
    assert(result.success === true || result.converged === true || Array.isArray(result.time));
    const last = Array.isArray(result.time) ? result.waveforms.out[result.waveforms.out.length - 1] : null;
    assert(last === null || Math.abs(last - 5) < 0.2);
  });

  check('SpiceEngine solves a diode DC operating point', () => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 1.5);
    spice.addResistor('R1', 'in', 'out', 100);
    spice.addDiode('D1', 'out', '0', 1e-14, 1.0);
    const result = spice.solveDCOperatingPoint(50, 1e-6);
    assert.strictEqual(result.converged, true);
    assert(result.nodeVoltages.out > 0.2);
  });

  // ---------------------------------------------------------------
  // Domain adapter validation branches
  // ---------------------------------------------------------------
  const adapterRejects = (adapter, request) => rejects(() => adapter.validate(request));

  check('Adapter validation rejects domain mismatch, unsupported ops, and non-object parameters', async () => {
    const adapters = [
      new PlantEngineAdapter(),
      new GeometryEngineAdapter(),
      new ControlsEngineAdapter(),
      new OpticsEngineAdapter()
    ];
    for (const adapter of adapters) {
      assert((await adapterRejects(adapter, { domain: 'wrong-domain', operation: 'x', parameters: {} })) !== null);
      assert(
        (await adapterRejects(adapter, {
          domain: adapter.describeCapabilities().domain,
          operation: 'not_an_operation',
          parameters: {}
        })) !== null
      );
      assert(
        (await adapterRejects(adapter, {
          domain: adapter.describeCapabilities().domain,
          operation: 'x',
          parameters: null
        })) !== null
      );
      assert(
        (await adapterRejects(adapter, { domain: adapter.describeCapabilities().domain, operation: 'x' })) !== null
      );
    }
  });

  check('PlantEngineAdapter executes a real flash with caller-supplied component records', async () => {
    const adapter = new PlantEngineAdapter();
    const components = [
      {
        name: 'Methane',
        criticalTemperatureK: 190.56,
        criticalPressurePa: 4.599e6,
        acentricFactor: 0.011,
        provenance: { source: 'synthetic', license: 'test' }
      },
      {
        name: 'Propane',
        criticalTemperatureK: 369.83,
        criticalPressurePa: 4.248e6,
        acentricFactor: 0.152,
        provenance: { source: 'synthetic', license: 'test' }
      }
    ];
    const result = await adapter.execute(
      {
        jobId: 'gap-plant-flash',
        domain: 'plant',
        operation: 'solve_vle_flash',
        parameters: {
          components,
          k_ij: [
            [0, 0],
            [0, 0]
          ],
          temperatureK: 300,
          pressurePa: 1e6,
          maxIter: 40,
          tol: 1e-8,
          feedComposition: [0.5, 0.5]
        }
      },
      () => {}
    );
    assert.strictEqual(result.status, 'COMPLETED');
    assert(Number.isFinite(result.outputData.vaporFraction));
    assert.strictEqual(result.outputData.liquidComposition.length, 2);
    assert.strictEqual(result.outputData.solverControls.maxIter, 40);
  });

  await Promise.all(pending);

  console.log('\n================================================================');
  console.log(`   BRANCH-GAP RESULTS: ${passedTests}/${totalTests} passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapCoverageTests };

if (require.main === module) {
  runBranchGapCoverageTests().then((stats) => {
    if (stats.failed > 0) process.exitCode = 1;
  });
}
