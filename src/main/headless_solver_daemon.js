/**
 * Experimental local dispatcher for selected JavaScript calculations.
 * This module is not an HPC provider and does not establish solver convergence.
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Core Solvers
const { FEASolver } = require('../core/cae/fea_structural');
const { FVMNavierStokes3D } = require('../core/cae/fvm_navier_stokes_3d');
const { PolarizationRayTracer } = require('../core/optics/polarization_ray_tracer');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../core/plant/naphtali_sandholm_mesh');
const { StaticTimingAnalysis } = require('../core/eda/static_timing_analysis');
const { AutocoderCRust } = require('../core/dynamic_simulink/autocoder_c_rust');
const { MCDCCoverageAnalyzer } = require('../core/dynamic_simulink/mcdc_coverage');
const { DomainDecompositionEngine } = require('../core/math/domain_decomposition');
const { defaultEngineRegistry } = require('../core/contracts/engine_registry');

function getOrCreateRoboticsAdapter(registry = defaultEngineRegistry) {
  return registry?.hasAdapter?.('robotics') ? registry.getAdapter('robotics') : null;
}

function ensureRoboticsRegistered(registry = defaultEngineRegistry) {
  return getOrCreateRoboticsAdapter(registry);
}

class HeadlessSolverDaemon {
  /** Returns a static process description, not a cluster readiness check. */
  static getHealth() {
    ensureRoboticsRegistered(defaultEngineRegistry);
    return {
      status: 'experimental',
      releaseApproved: false,
      version: process.env.npm_package_version || 'unreleased',
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      registeredDomains: defaultEngineRegistry.listRegisteredDomains(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Dispatches a local experimental calculation.
   * @param {Object} jobSpec
   * @returns {Object} Solution results and execution telemetry
   */
  dispatchJob(jobSpec) {
    if (!jobSpec || typeof jobSpec !== 'object') throw new TypeError('A job specification is required.');
    const requestedDiscipline = jobSpec.type || jobSpec.discipline;
    if (typeof requestedDiscipline !== 'string' || !requestedDiscipline.trim())
      throw new TypeError('A discipline is required.');
    const discipline = requestedDiscipline.toLowerCase();
    const parameters = jobSpec.params || jobSpec.parameters;
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))
      throw new TypeError('Solver parameters are required.');
    return HeadlessSolverDaemon.solveJob({ discipline, parameters });
  }

  /**
   * Static alias for job dispatch
   * @param {Object} jobSpec
   * @returns {Object} Solution results
   */
  static dispatchJob(jobSpec) {
    if (!jobSpec || typeof jobSpec !== 'object') throw new TypeError('A job specification is required.');
    const requestedDiscipline = jobSpec.type || jobSpec.discipline;
    if (typeof requestedDiscipline !== 'string' || !requestedDiscipline.trim())
      throw new TypeError('A discipline is required.');
    const discipline = requestedDiscipline.toLowerCase();
    const parameters = jobSpec.params || jobSpec.parameters;
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))
      throw new TypeError('Solver parameters are required.');
    return HeadlessSolverDaemon.solveJob({ discipline, parameters });
  }

  /**
   * Dispatches and solves a batch engineering job
   * @param {Object} jobSpec
   * @param {string} jobSpec.discipline - 'fea' | 'cfd' | 'plant' | 'optics' | 'eda' | 'controls' | 'robotics'
   * @param {Object} jobSpec.parameters - Solver-specific input specification
   * @returns {Object} Solution results and execution telemetry
   */
  static solveJob(jobSpec) {
    if (!jobSpec || typeof jobSpec !== 'object') throw new TypeError('A job specification is required.');
    const discipline = jobSpec.discipline;
    const parameters = jobSpec.parameters;
    if (typeof discipline !== 'string' || !discipline.trim()) throw new TypeError('A discipline is required.');
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters))
      throw new TypeError('Solver parameters are required.');
    const tStart = Date.now();

    let result = null;

    switch (discipline) {
      case 'fea': {
        const solver = new FEASolver();
        if (parameters.nodes) {
          parameters.nodes.forEach((n) => solver.addNode(n.x, n.y, n.z));
        }
        if (parameters.elements) {
          parameters.elements.forEach((e) => solver.addElement(e.nodes || e, e.material));
        }
        result = solver.solveStatic();
        break;
      }
      case 'cfd': {
        if (!Number.isInteger(parameters.steps) || parameters.steps < 1) {
          throw new TypeError('CFD headless dispatch requires an explicit positive integer steps value.');
        }
        const cfd = new FVMNavierStokes3D(parameters);
        result = cfd.solveSteps(parameters.steps);
        break;
      }
      case 'plant': {
        if (
          parameters.operation === 'calculate_steam_properties' ||
          parameters.type === 'steam' ||
          parameters.type === 'iapws_if97'
        ) {
          const { IAPWS_IF97 } = require('../core/plant/iapws_if97');
          result = IAPWS_IF97.calculateProperties(parameters.pressurePa, parameters.temperatureK);
        } else if (parameters.operation === 'calculate_pinch_targets' || parameters.type === 'pinch') {
          const { PinchEnergyTargeter } = require('../core/plant/pinch_energy_targeter');
          result = PinchEnergyTargeter.calculateTargets(parameters.streams, parameters.deltaTmin);
        } else if (parameters.operation === 'characterize_petroleum_assay' || parameters.type === 'assay') {
          const { PetroleumAssayCharacterizer } = require('../core/plant/petroleum_assay_characterizer');
          const assayParams = parameters.options || parameters;
          const assay = new PetroleumAssayCharacterizer(assayParams);
          result = assay.characterize(assayParams);
        } else if (parameters.type === 'water_hammer') {
          result = WaterHammerMOC.solve(parameters);
        } else {
          result = NaphtaliSandholmColumnSolver.solve(parameters);
        }
        break;
      }
      case 'pdm': {
        const { EngineeringBOMManager } = require('../core/pdm/engineering_bom_manager');
        const { GitCADVisualDiffEngine } = require('../core/pdm/git_cad_visual_diff');
        if (parameters.operation === 'visual_diff_cad' || parameters.type === 'visual_diff') {
          if (!Number.isFinite(parameters.toleranceMm) || !Number.isFinite(parameters.modificationThresholdMm)) {
            throw new TypeError('CAD visual diff requires explicit toleranceMm and modificationThresholdMm.');
          }
          const diff = new GitCADVisualDiffEngine({
            toleranceMm: parameters.toleranceMm,
            modificationThresholdMm: parameters.modificationThresholdMm
          });
          result = diff.compareRevisions(parameters.revisionA, parameters.revisionB);
        } else {
          const manager = new EngineeringBOMManager();
          manager.setRootAssembly(parameters.rootAssembly || parameters.rootItem || parameters.bom);
          result = manager.computeRollUp();
        }
        break;
      }
      case 'hpc': {
        const { HpcClusterGateway } = require('../core/hpc/hpc_cluster_gateway');
        if (parameters.operation === 'generate_slurm_script' || parameters.type === 'slurm') {
          result = HpcClusterGateway.generateSlurmScript(parameters);
        } else if (parameters.operation === 'generate_pbs_script' || parameters.type === 'pbs') {
          result = HpcClusterGateway.generatePbsScript(parameters);
        } else if (parameters.operation === 'partition_rcb' || parameters.type === 'rcb') {
          result = HpcClusterGateway.partitionRcb(parameters.points, parameters.numPartitions);
        } else if (parameters.operation === 'plan_out_of_core' || parameters.type === 'plan_out_of_core') {
          result = HpcClusterGateway.planOutOfCoreFrontal(
            parameters.dofCount,
            parameters.availableRamBytes,
            parameters.assumptions
          );
        } else {
          result = { status: 'unavailable', code: 'UNSUPPORTED', reason: 'An explicit HPC operation is required.' };
        }
        break;
      }
      case 'optics': {
        result = PolarizationRayTracer.evaluateFresnel(parameters.n1, parameters.n2, parameters.thetaI);
        break;
      }
      case 'eda': {
        result = StaticTimingAnalysis.evaluateMCMM(parameters);
        break;
      }
      case 'controls': {
        if (parameters.action === 'mcdc') {
          result = MCDCCoverageAnalyzer.generateMCDCTestSuite(parameters.conditions, parameters.func);
        } else if (parameters.action === 'autocode') {
          result = AutocoderCRust.generateMisraC(parameters);
        } else {
          result = {
            status: 'unavailable',
            code: 'UNSUPPORTED',
            reason: 'Headless controls co-simulation requires an explicit reviewed FMI model and is unavailable.'
          };
        }
        break;
      }
      case 'robotics': {
        result = {
          status: 'unavailable',
          code: 'UNSUPPORTED',
          reason:
            'The synchronous headless robotics route has no validated adapter. Use EngineRegistry.dispatch for explicit experimental jobs.'
        };
        break;
      }
      case 'partition': {
        if (!Number.isInteger(parameters.numPartitions) || parameters.numPartitions < 1) {
          throw new TypeError('Mesh partitioning requires an explicit positive integer numPartitions.');
        }
        result = DomainDecompositionEngine.partitionMesh(
          parameters.nodes,
          parameters.elements,
          parameters.numPartitions
        );
        break;
      }
      default:
        throw new Error(`Unknown discipline '${discipline}'`);
    }

    const tEnd = Date.now();
    return {
      status: result?.status === 'unavailable' ? 'UNAVAILABLE' : 'COMPUTED_EXPERIMENTAL',
      validationLevel: 'experimental',
      discipline,
      durationMs: tEnd - tStart,
      timestamp: new Date().toISOString(),
      result
    };
  }

  /**
   * Main CLI entry point
   */
  static runCLI(args = process.argv.slice(2)) {
    if (args.includes('--health')) {
      const health = this.getHealth();
      console.log(JSON.stringify(health, null, 2));
      process.exitCode = 0;
      return;
    }

    const solveIdx = args.indexOf('--solve');
    if (solveIdx !== -1) {
      try {
        let inputPath = null;
        let outputPath = null;

        for (const arg of args) {
          if (arg.startsWith('--input=')) inputPath = arg.split('=')[1];
          if (arg.startsWith('--out=')) outputPath = arg.split('=')[1];
        }

        if (!inputPath) {
          console.error('Error: --input=<spec.json> is required with --solve');
          process.exit(1);
        }

        const raw = fs.readFileSync(path.resolve(inputPath), 'utf8');
        const spec = JSON.parse(raw);
        const res = this.solveJob(spec);

        const outJson = JSON.stringify(res, null, 2);
        if (outputPath) {
          fs.writeFileSync(path.resolve(outputPath), outJson, 'utf8');
          console.log(`[OmniEng] Experimental calculation result written to ${outputPath}`);
        } else {
          console.log(outJson);
        }
        process.exitCode = 0;
      } catch (err) {
        console.error(`[OmniEng Experimental Dispatcher Error] ${err.message}`);
        process.exitCode = 1;
        return;
      }
    }

    console.log('OmniEng Experimental Local Solver Dispatcher');
    console.log('Usage:');
    console.log('  node src/main/headless_solver_daemon.js --health');
    console.log('  node src/main/headless_solver_daemon.js --solve --input=<spec.json> [--out=<out.json>]');
  }
}

// Auto-run when executed directly from CLI
if (require.main === module) {
  HeadlessSolverDaemon.runCLI();
}

module.exports = {
  HeadlessSolverDaemon,
  ensureRoboticsRegistered,
  getOrCreateRoboticsAdapter
};
