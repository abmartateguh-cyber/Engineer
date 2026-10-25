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
const { OpticalGlassCatalog } = require('../core/optics/optical_glass_catalog');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../core/plant/naphtali_sandholm_mesh');
const { LefDefParser } = require('../core/eda/lef_def_parser');
const { Sky130PdkAdapter } = require('../core/eda/sky130_pdk_adapter');
const { StaticTimingAnalysis } = require('../core/eda/static_timing_analysis');
const { AutocoderCRust } = require('../core/dynamic_simulink/autocoder_c_rust');
const { MCDCCoverageAnalyzer } = require('../core/dynamic_simulink/mcdc_coverage');
const { FmiMasterEngine, FmuSlave } = require('../core/cosim/fmi_master_engine');
const { DomainDecompositionEngine } = require('../core/math/domain_decomposition');

class HeadlessSolverDaemon {
  /** Returns a static process description, not a cluster readiness check. */
  static getHealth() {
    return {
      status: 'experimental',
      releaseApproved: false,
      version: process.env.npm_package_version || 'unreleased',
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
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
   * @param {string} jobSpec.discipline - 'fea' | 'cfd' | 'plant' | 'optics' | 'eda' | 'controls'
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
        const cfd = new FVMNavierStokes3D(parameters);
        result = cfd.solveSteps(parameters.steps || 50);
        break;
      }
      case 'plant': {
        if (parameters.type === 'water_hammer') {
          result = WaterHammerMOC.solve(parameters);
        } else {
          result = NaphtaliSandholmColumnSolver.solve(parameters);
        }
        break;
      }
      case 'optics': {
        result = PolarizationRayTracer.evaluateFresnel(
          parameters.n1 || 1.0,
          parameters.n2 || 1.5,
          parameters.thetaI || 0.0
        );
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
          const master = new FmiMasterEngine(parameters.config || {});
          result = master.solveAlgebraicLoop();
        }
        break;
      }
      case 'partition': {
        result = DomainDecompositionEngine.partitionMesh(
          parameters.nodes,
          parameters.elements,
          parameters.numPartitions || 4
        );
        break;
      }
      default:
        throw new Error(`Unknown discipline '${discipline}'`);
    }

    const tEnd = Date.now();
    return {
      status: 'COMPUTED_EXPERIMENTAL',
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
  HeadlessSolverDaemon
};
