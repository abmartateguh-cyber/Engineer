/**
 * Experimental multi-physics module smoke checks
 *
 * Exercises:
 * 1. STOP Multiphysics (FEA-Thermal-Optical Zernike surface sag & Schott dn/dT dispersion).
 * 2. HPC Cluster Gateway (Slurm sbatch, PBS Pro qsub, Recursive Coordinate Bisection).
 * 3. CAD G2 Variable-Radius Rolling-Ball Fillet & Gregory Corner Blend Patches.
 * 4. Transient Water Hammer MOC Hydraulic Surge Solver & experimental water-hammer calculation example.
 * 5. Caller-supplied experimental SPEF-shaped RC formula example.
 *
 * These checks do not establish solver validation or release readiness.
 */

'use strict';

const assert = require('assert');
const opticalExamples = require('./support/experimental_optics_examples');
const { EXPERIMENTAL_SPEF_TEST_DATA } = require('./support/experimental_spef_inputs');

// 1. STOP Multiphysics
const { StopMultiphysicsCoupling } = require('../src/core/optics/stop_multiphysics_coupling.js');

// 2. HPC Cluster Gateway
const { HpcClusterGateway } = require('../src/core/math/hpc_cluster_gateway.js');

// 3. Variable Fillet & Gregory Patch
const { VariableRadiusFilletEngine, GregoryCornerPatch } = require('../src/core/cad/variable_fillet_gregory.js');

// 4. Transient Water Hammer MOC
const { TransientWaterHammerSolver } = require('../src/core/plant/transient_water_hammer.js');

// 5. SPEF Parasitic Extractor
const { SpefParasiticExtractor } = require('../src/core/eda/parasitic_spef_extractor.js');

function runIndustrialMasterEnginesTests() {
  console.log('================================================================');
  console.log('   RUNNING EXPERIMENTAL MULTI-PHYSICS MODULE CHECKS  ');
  console.log('================================================================');

  let passedTests = 0;
  let totalTests = 0;

  function it(name, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✓ PASSED: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
      process.exitCode = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. STOP Multiphysics Coupling
  // ---------------------------------------------------------------------------
  console.log('\n[SECTION 1] STOP Multiphysics Coupling (Structural-Thermal-Optical)');

  it('StopMultiphysicsCoupling evaluates 37-term Fringe Zernike polynomials', () => {
    // Piston (Z1 = 1)
    assert.strictEqual(StopMultiphysicsCoupling.evaluateZernike(1, 0.5, 0), 1.0);

    // Tip/Tilt (Z2 = rho*cos(phi), Z3 = rho*sin(phi))
    const z2 = StopMultiphysicsCoupling.evaluateZernike(2, 0.8, 0.0);
    assert.strictEqual(Number(z2.toFixed(3)), 0.8);

    const z3 = StopMultiphysicsCoupling.evaluateZernike(3, 0.8, Math.PI / 2);
    assert.strictEqual(Number(z3.toFixed(3)), 0.8);

    // Defocus (Z4 = 2*rho^2 - 1)
    const z4 = StopMultiphysicsCoupling.evaluateZernike(4, 1.0, 0);
    assert.strictEqual(Number(z4.toFixed(3)), 1.0);
  });

  it('StopMultiphysicsCoupling calculates from explicit test-only thermo-optic coefficients', () => {
    const glass = opticalExamples.thermalGlassExamples['N-BK7'];
    const properties = {
      D0PerK: glass.D0,
      D1PerK2: glass.D1,
      D2PerK3: glass.D2,
      E0Um2PerK: glass.E0,
      E1Um2PerK2: glass.E1,
      lambdaTkUm: glass.lambdaTk,
      glassCtePerK: glass.cte,
      source: 'test-only unverified optical example'
    };
    const deltaN = StopMultiphysicsCoupling.computeDnDt(properties, 1.5168, 40.0, 0.5876);

    assert(deltaN > 0, 'N-BK7 has positive dn/dT thermo-optic coefficient');
    assert(deltaN < 0.001, 'deltaN for 40K delta should be in 1e-4 range');
  });

  it('StopMultiphysicsCoupling executes coupled FEA-thermal ray perturbation and MTF loss', () => {
    const glass = opticalExamples.thermalGlassExamples['N-BK7'];
    const analysis = StopMultiphysicsCoupling.solveStopCoupling(
      {
        entrancePupilDiameterMm: 50.0,
        baselineStrehl: 0.96,
        refractiveIndexAtReferenceTemperature: 1.5168,
        glassCtePerK: glass.cte,
        structuralComplianceMmPerN: 1.2e-7,
        thermalSagCoefficientMmPerK: 4e-7,
        structuralPropertiesSource: 'test-only unverified optical example',
        thermalProperties: {
          D0PerK: glass.D0,
          D1PerK2: glass.D1,
          D2PerK3: glass.D2,
          E0Um2PerK: glass.E0,
          E1Um2PerK2: glass.E1,
          lambdaTkUm: glass.lambdaTk,
          glassCtePerK: glass.cte,
          source: 'test-only unverified optical example'
        }
      },
      { ambientTempC: 65.0, referenceTempC: 20.0, structuralLoadN: 50.0, wavelengthUm: 0.5876 }
    );

    assert.strictEqual(analysis.status, 'EXPERIMENTAL_ESTIMATE');
    assert.strictEqual(analysis.validationLevel, 'experimental');
    assert(analysis.rmsWfeWaves > 0, 'Thermal soak must induce non-zero RMS wavefront error');
    assert(analysis.degradedStrehl <= analysis.baselineStrehl, 'Degraded Strehl ratio must not exceed baseline');
    assert(analysis.degradedStrehl > 0.0, 'Strehl ratio must remain positive');
    assert(analysis.thermalSoakMtf.lp10 > 0, 'MTF contrast must be positive');
    assert.match(analysis.warnings[0], /no coupled structural solve/);
  });

  // ---------------------------------------------------------------------------
  // 2. HPC Cluster Gateway
  // ---------------------------------------------------------------------------
  console.log('\n[SECTION 2] HPC Cluster Gateway (Slurm, PBS Pro & RCB Partitioning)');

  it('HpcClusterGateway generates a Slurm script example', () => {
    const slurm = HpcClusterGateway.generateSlurmScript({
      jobName: 'raptor_coupled_cfd',
      partition: 'gpu-h100',
      nodes: 4,
      ntasksPerNode: 8,
      gpusPerNode: 4,
      cpusPerTask: 16,
      solverExecutable: 'omnieng-cfd-mpi'
    });

    assert(slurm.script.includes('#!/bin/bash'), 'Slurm script must include bash shebang');
    assert(slurm.script.includes('#SBATCH --job-name=raptor_coupled_cfd'), 'Must specify job name');
    assert(slurm.script.includes('#SBATCH --nodes=4'), 'Must specify nodes');
    assert(slurm.script.includes('#SBATCH --gres=gpu:4'), 'Must specify GPU count');
    assert.strictEqual(slurm.totalCores, 4 * 8 * 16);
    assert.strictEqual(slurm.totalGpus, 16);
  });

  it('HpcClusterGateway generates a PBS script example', () => {
    const pbs = HpcClusterGateway.generatePbsScript({
      jobName: 'battery_thermal_fea',
      nodes: 2,
      mpiRanksPerNode: 8,
      cpusPerRank: 8,
      walltime: '12:00:00'
    });

    assert(pbs.script.includes('#PBS -N battery_thermal_fea'), 'PBS must specify job name');
    assert(
      pbs.script.includes('#PBS -l select=2:ncpus=64:mpiprocs=8:ompthreads=8'),
      'PBS must specify select statement'
    );
    assert(pbs.script.includes('mpiexec -n 16 omnieng-headless-daemon'), 'PBS must launch mpiexec');
  });

  it('HpcClusterGateway performs Recursive Coordinate Bisection (RCB) domain decomposition', () => {
    // Generate synthetic 3D point cloud
    const points = [];
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        for (let z = 0; z < 4; z++) {
          points.push({ x, y, z });
        }
      }
    }

    const decomp = HpcClusterGateway.partitionRcb(points, 4); // 4 subdomains
    assert.strictEqual(decomp.status, 'PARTITIONED');
    assert.strictEqual(decomp.numPartitions, 4);
    assert.strictEqual(decomp.totalNodes, points.length);
    assert.strictEqual(decomp.isBalanced, true);
  });

  it('HpcClusterGateway reports a caller-assumption-based storage estimate only', () => {
    const chunking = HpcClusterGateway.planOutOfCoreFrontal(
      5000000,
      16 * 1024 * 1024 * 1024,
      { matrixNonzerosPerDof: 180, factorEntriesPerDof: 450 }
    );

    assert.strictEqual(chunking.status, 'ESTIMATE_ONLY');
    assert.strictEqual(chunking.solvePerformed, false);
    assert.strictEqual(chunking.estimatedOutOfCore, true);
    assert.strictEqual(chunking.isOutOfCore, null);
    assert(chunking.totalChunks > 1, 'The stated memory assumptions imply multiple estimated chunks');
    assert(chunking.chunkSizeDofs > 0, 'Estimated chunk size must be positive');
  });

  // ---------------------------------------------------------------------------
  // 3. Variable Radius Fillet & Gregory Corner Blend
  // ---------------------------------------------------------------------------
  console.log('\n[SECTION 3] Variable Fillet & Gregory Corner Patch Engine');

  it('VariableRadiusFilletEngine generates rolling-ball variable radius blend surface', () => {
    const spine = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
      { x: 30, y: 0, z: 0 }
    ];

    const fillet = VariableRadiusFilletEngine.generateVariableFillet({
      spinePoints: spine,
      startRadius: 2.0,
      endRadius: 8.0,
      continuity: 'G2',
      samplesV: 6
    });

    assert.strictEqual(fillet.success, true);
    assert.strictEqual(fillet.continuity, 'G2');
    assert.strictEqual(fillet.meshGrid.length, 4);
    assert.strictEqual(fillet.contactPointsLeft.length, 4);
    assert.strictEqual(fillet.contactPointsRight.length, 4);

    // Verify linear radius variation: start = 2.0, end = 8.0
    assert.strictEqual(fillet.meshGrid[0][0].radius, 2.0);
    assert.strictEqual(fillet.meshGrid[3][0].radius, 8.0);
  });

  it('GregoryCornerPatch evaluates N-sided vertex corner blend', () => {
    const curveA = { evaluate: (t) => ({ x: t * 10, y: 0, z: 0, normal: { x: 0, y: 1, z: 0 } }) };
    const curveB = { evaluate: (t) => ({ x: 0, y: t * 10, z: 0, normal: { x: 1, y: 0, z: 0 } }) };
    const curveC = { evaluate: (t) => ({ x: 0, y: 0, z: t * 10, normal: { x: 0, y: 0, z: 1 } }) };

    const patch = new GregoryCornerPatch([curveA, curveB, curveC]);
    assert.strictEqual(patch.nSides, 3);

    const ptCenter = patch.evaluate([0.333, 0.333, 0.334]);
    assert(ptCenter.x >= 0 && ptCenter.y >= 0 && ptCenter.z >= 0);
    assert(ptCenter.normal !== undefined);
  });

  // ---------------------------------------------------------------------------
  // 4. Transient Water Hammer MOC Hydraulic Solver
  // ---------------------------------------------------------------------------
  console.log('\n[SECTION 4] Transient Water Hammer & Hydraulic Shockwave MOC');

  it('TransientWaterHammerSolver calculates wave speed from explicit conduit inputs', () => {
    assert.throws(() => TransientWaterHammerSolver.calculateWaveSpeed(), /requires explicit finite inputs/);
    // Caller-supplied example values; not a material or fluid property record.
    const waveSpeed = TransientWaterHammerSolver.calculateWaveSpeed({
      fluidDensity: 2,
      fluidBulkModulus: 1e6,
      pipeElasticModulus: 2e8,
      pipeInnerDiameter: 0.3,
      pipeWallThickness: 0.008,
      restraintFactor: 1.0
    });

    assert(waveSpeed > 600 && waveSpeed < 800, `Wave speed (${waveSpeed} m/s) follows the supplied synthetic inputs`);
  });

  it('TransientWaterHammerSolver computes Joukowsky theoretical peak surge', () => {
    assert.throws(
      () => TransientWaterHammerSolver.joukowskySurge(1200.0, 2.0),
      /requires positive waveSpeed and density/
    );
    const surge = TransientWaterHammerSolver.joukowskySurge(12.0, 3.0, 2.0);
    assert.strictEqual(surge.surgePressurePa, 72);
    assert(Math.abs(surge.surgeHeadM - (36 / 9.80665)) < 0.01);
  });

  it('TransientWaterHammerSolver returns an experimental 1D MOC estimate without a code verdict', () => {
    assert.throws(() => TransientWaterHammerSolver.solveTransientMOC(), /requires explicit inputs/);
    const sim = TransientWaterHammerSolver.solveTransientMOC({
      pipeLength: 600.0,
      pipeDiameter: 0.25,
      pipeWallThickness: 0.007,
      darcyFrictionFactor: 0.02,
      reservoirHead: 80.0,
      steadyFlowRate: 0.1,
      valveClosureTime: 0.4,
      valveClosureLaw: 'linear',
      simulationDuration: 5.0,
      reaches: 12,
      fluidDensity: 2,
      fluidBulkModulus: 1e6,
      pipeElasticModulus: 2e8,
      restraintFactor: 1.0
    });

    assert.strictEqual(sim.success, true);
    assert.strictEqual(sim.courantNumber, 1.0);
    assert.strictEqual(sim.codeAssessment, 'NOT_PERFORMED');
    assert(sim.totalStepsExecuted > 50);
    assert(sim.maxHeadObserved > sim.initialDischarge);
    assert(sim.valveTelemetry.timeHistory.length > 10);
    assert.strictEqual(sim.validationLevel, 'experimental');
    assert.strictEqual(sim.screeningStatus, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(sim.codeAssessment, 'NOT_PERFORMED');
    assert(typeof sim.peakHoopStressMpaEstimate === 'number');
    assert.strictEqual(Object.hasOwn(sim, 'codeCompliance'), false);
  });

  // ---------------------------------------------------------------------------
  // 5. SPEF Coupled RC Parasitic Extractor
  // ---------------------------------------------------------------------------
  console.log('\n[SECTION 5] Caller-supplied SPEF RC Formula Smoke Check (IEEE 1481)');

  it('SpefParasiticExtractor writes SPEF-shaped records and lumped RC formula estimates', () => {
    const pexResult = SpefParasiticExtractor.extractDesignSPEF({
      designName: 'alu_core_32b',
      techPdk: EXPERIMENTAL_SPEF_TEST_DATA,
      nets: [
        {
          name: 'clk_tree_root',
          pins: [
            { name: 'clk_gen/out', direction: 'output', isPort: true, x: 10, y: 10 },
            { name: 'reg_bank/clk', direction: 'input', isPort: false, x: 250, y: 150 }
          ],
          segments: [
            {
              layer: 'test_metal_a',
              lengthUm: 120.0,
              widthUm: 0.28,
              hasVia: true,
              fromNode: 'clk_tree_root:1',
              toNode: 'clk_tree_root:2'
            },
            {
              layer: 'test_metal_b',
              lengthUm: 80.0,
              widthUm: 0.18,
              hasVia: false,
              fromNode: 'clk_tree_root:2',
              toNode: 'clk_tree_root:3'
            }
          ],
          crossCouplings: [{ nodeA: 'clk_tree_root:1', nodeB: 'bus_data[0]:1', capFf: 0.35 }]
        },
        {
          name: 'bus_data[0]',
          pins: [
            { name: 'alu/out[0]', direction: 'output', isPort: false, x: 100, y: 100 },
            { name: 'ram/din[0]', direction: 'input', isPort: false, x: 200, y: 100 }
          ],
          segments: [
            {
              layer: 'test_metal_a',
              lengthUm: 65.0,
              widthUm: 0.14,
              hasVia: false,
              fromNode: 'bus_data[0]:1',
              toNode: 'bus_data[0]:2'
            }
          ],
          crossCouplings: []
        }
      ]
    });

    assert.strictEqual(pexResult.success, true);
    assert.strictEqual(pexResult.netCount, 2);
    assert.strictEqual(pexResult.dataStatus, 'caller-supplied-unverified');
    assert.strictEqual(pexResult.technologyOrDatasetName, 'synthetic-spef-formula-test-data');
    assert(pexResult.totalDesignCapacitanceFf > 0);
    assert(pexResult.totalInterconnectResistanceOhms > 0);
    assert(pexResult.totalCrossCouplingCapacitanceFf > 0);

    // Verify IEEE 1481 mandatory syntax
    const spef = pexResult.spefText;
    assert(spef.includes('*SPEF "IEEE 1481-1999"'), 'Must contain SPEF IEEE header');
    assert(spef.includes('*DESIGN "alu_core_32b"'), 'Must contain design name');
    assert(spef.includes('*D_NET clk_tree_root'), 'Must contain clk_tree_root D_NET');
    assert(spef.includes('*CONN'), 'Must contain *CONN block');
    assert(spef.includes('*CAP'), 'Must contain *CAP block');
    assert(spef.includes('*RES'), 'Must contain *RES block');
    assert(spef.includes('*END'), 'Must contain *END delimiter');

    // Test Elmore Delay
    assert(pexResult.extractedNets[0].lumpedRcTimeConstantPs > 0, 'Lumped RC time constant estimate must be non-zero');
    assert(
      pexResult.extractedNets[0].lumpedFirstOrderSlew90Ps > pexResult.extractedNets[0].lumpedRcTimeConstantPs,
      'First-order 10-90 slew estimate must exceed the lumped RC time constant'
    );
  });

  it('SpefParasiticExtractor rejects absent PDK records and implicit segment properties', () => {
    assert.throws(
      () => SpefParasiticExtractor.extractDesignSPEF({ designName: 'net', nets: [] }),
      /Explicit layer property records/
    );
    assert.throws(
      () =>
        SpefParasiticExtractor.extractDesignSPEF({
          designName: 'net',
          techPdk: EXPERIMENTAL_SPEF_TEST_DATA,
          nets: [{ name: 'n', pins: [], segments: [{ layer: 'test_metal_a' }], crossCouplings: [] }]
        }),
      /lengthUm must be a finite positive number/
    );
    assert.throws(() => SpefParasiticExtractor.parseSPEF(''), /non-empty SPEF text/);
  });

  it('SpefParasiticExtractor parses IEEE 1481 SPEF back into structured graph', () => {
    const rawSpef = `
*SPEF "IEEE 1481-1999"
*DESIGN "mac_unit"
*D_NET net_a 4.5200
*CONN
*P pad_in I *C 0 0
*I core/in I *C 10 20
*CAP
1 net_a:1 1.2500
2 net_a:1 net_b:1 0.4200
*RES
1 net_a:1 net_a:2 12.5000
*END
`;
    const parsed = SpefParasiticExtractor.parseSPEF(rawSpef);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.design, 'mac_unit');
    assert.strictEqual(parsed.nets.length, 1);
    assert.strictEqual(parsed.nets[0].name, 'net_a');
    assert.strictEqual(parsed.nets[0].totalCap, 4.52);
    assert.strictEqual(parsed.nets[0].connections.length, 2);
    assert.strictEqual(parsed.nets[0].caps.length, 2);
    assert.strictEqual(parsed.nets[0].caps[1].isCrossCoupling, true);
    assert.strictEqual(parsed.nets[0].resistors.length, 1);
    assert.strictEqual(parsed.nets[0].resistors[0].resOhms, 12.5);
  });

  console.log('\n================================================================');
  console.log(`  SUMMARY: ${passedTests} / ${totalTests} EXPERIMENTAL MASTER ENGINE SMOKE CHECKS PASSED`);
  console.log('================================================================\n');

  return { total: totalTests, passed: passedTests };
}

module.exports = { runIndustrialMasterEnginesTests };

if (require.main === module) {
  const res = runIndustrialMasterEnginesTests();
  if (res.passed !== res.total) {
    process.exit(1);
  }
}
