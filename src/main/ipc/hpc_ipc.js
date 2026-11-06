/**
 * OmniEng HPC IPC Router
 *
 * Exposes Slurm/PBS MPI cluster batch script generation, OpenFOAM case deck
 * generation (rhoCentralFoam shock CFD and interFoam VOF multiphase), CalculiX
 * non-linear plastic FEA and dynamic explicit input decks, and live solver log
 * telemetry parsing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { defineHandler } = require('./define_handler');
const { SlurmClusterGateway, getSlurmGateway } = require('../../core/hpc/slurm_mpi_cluster_gateway');
const { OpenFoamCaseGenerator } = require('../../core/hpc/openfoam_case_generator');
const { CalculixCaseGenerator } = require('../../core/hpc/calculix_case_generator');

const SLURM_BATCH_SCRIPT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    scheduler: { type: 'string', enum: ['slurm', 'pbs'], optional: true },
    jobName: { type: 'string', optional: true },
    solverType: { type: 'string', enum: ['openfoam', 'calculix', 'custom'], optional: true },
    nodes: { type: 'number', integer: true, min: 1, optional: true },
    ntasksPerNode: { type: 'number', integer: true, min: 1, optional: true },
    cores: { type: 'number', integer: true, min: 1, optional: true },
    totalCores: { type: 'number', integer: true, min: 1, optional: true },
    walltime: { type: 'string', optional: true },
    executable: { type: 'string', optional: true },
    args: { type: 'string', optional: true },
    extraArgs: { type: 'string', optional: true },
    casePath: { type: 'string', optional: true },
    outputFile: { type: 'string', optional: true },
    errorFile: { type: 'string', optional: true },
    partition: { type: 'string', optional: true },
    queue: { type: 'string', optional: true },
    mpiBindings: { type: 'string', optional: true },
    cpuBind: { type: 'string', optional: true },
    decomposeMethod: { type: 'string', enum: ['scotch', 'metis', 'hierarchical', 'simple'], optional: true },
    env: { type: 'object', optional: true }
  }
});

const OPENFOAM_CASE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    application: {
      type: 'string',
      enum: ['rhoCentralFoam', 'interFoam', 'chtMultiRegionFoam', 'pimpleFoam'],
      optional: true
    },
    solver: {
      type: 'string',
      enum: ['rhoCentralFoam', 'interFoam', 'chtMultiRegionFoam', 'pimpleFoam'],
      optional: true
    },
    startTime: { type: 'number', optional: true },
    endTime: { type: 'number', optional: true },
    deltaT: { type: 'number', optional: true },
    writeInterval: { type: 'number', optional: true },
    maxCo: { type: 'number', optional: true },
    geometry: { type: 'string', enum: ['channel', 'cylinder'], optional: true },
    cells: { type: 'array', items: { type: 'number' }, optional: true },
    dims: { type: 'array', items: { type: 'number' }, optional: true },
    inletVelocity: { type: 'array', items: { type: 'number' }, optional: true },
    subdomains: { type: 'number', integer: true, min: 1, optional: true },
    numberOfSubdomains: { type: 'number', integer: true, min: 1, optional: true },
    cores: { type: 'number', integer: true, min: 1, optional: true },
    decomposeMethod: { type: 'string', enum: ['scotch', 'metis', 'hierarchical', 'simple'], optional: true },
    fluid: { type: 'object', optional: true },
    writeToDisk: { type: 'boolean', optional: true },
    casePath: { type: 'string', optional: true }
  }
});

const CALCULIX_CASE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    heading: { type: 'string', optional: true },
    nodes: { type: 'array', items: { type: 'array' }, optional: true },
    elements: { type: 'array', items: { type: 'array' }, optional: true },
    elementType: { type: 'string', enum: ['C3D8', 'C3D20', 'C3D8R'], optional: true },
    materialName: { type: 'string', optional: true },
    youngsModulus_MPa: { type: 'number', min: 0.001, optional: true },
    poissonsRatio: { type: 'number', optional: true },
    yieldStress_MPa: { type: 'number', min: 0.001, optional: true },
    hardeningStrain: { type: 'number', optional: true },
    density_kg_m3: { type: 'number', min: 0.001, optional: true },
    nodeSets: { type: 'object', optional: true },
    boundaryConditions: { type: 'array', optional: true },
    appliedLoads: { type: 'array', optional: true },
    isNonLinearGeom: { type: 'boolean', optional: true },
    stepType: { type: 'string', optional: true },
    writeToDisk: { type: 'boolean', optional: true },
    casePath: { type: 'string', optional: true }
  }
});

const SOLVER_TELEMETRY_SCHEMA = Object.freeze({
  type: 'object',
  required: ['logContent'],
  properties: {
    logContent: { type: 'string' },
    solver: { type: 'string', enum: ['openfoam', 'calculix', 'auto'], optional: true },
    convergenceThreshold: { type: 'number', optional: true }
  }
});

/**
 * Parses solver log telemetry from OpenFOAM or CalculiX log streams.
 * Extracts residuals for Ux, Uy, Uz, p, T, k, omega.
 *
 * @param {string} logContent
 * @param {string} [requestedSolver='auto']
 * @param {number} [convergenceThreshold=1e-3]
 * @returns {Object}
 */
function parseSolverTelemetry(logContent, requestedSolver = 'auto', convergenceThreshold = 1e-3) {
  if (typeof logContent !== 'string') {
    throw new Error('logContent must be a non-empty string.');
  }

  const isExplicitCalculix =
    requestedSolver === 'calculix' ||
    (requestedSolver === 'auto' &&
      (logContent.includes('*STATIC') ||
        logContent.includes('*DYNAMIC') ||
        logContent.includes('EQUILIBRIUM ITERATION') ||
        logContent.includes('CCX') ||
        logContent.includes('CalculiX')));

  const isOpenFoam =
    requestedSolver === 'openfoam' ||
    (!isExplicitCalculix &&
      (logContent.includes('Time =') ||
        logContent.includes('Solving for') ||
        logContent.includes('rhoCentralFoam') ||
        logContent.includes('interFoam') ||
        logContent.includes('pimpleFoam')));

  const lines = logContent.split('\n');
  const iterations = [];
  const monitoredVars = new Set();

  if (isOpenFoam || (!isExplicitCalculix && logContent.includes('Solving for'))) {
    const timeRegex = /^Time\s*=\s*([0-9.eE+-]+)/;
    const resRegex =
      /Solving for (Ux|Uy|Uz|p|T|k|omega|h|e|p_rgh|alpha\.[a-zA-Z0-9_]+),\s*Initial residual\s*=\s*([0-9.eE+-]+),\s*Final residual\s*=\s*([0-9.eE+-]+)/i;
    let currentIter = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const timeMatch = line.match(timeRegex);
      if (timeMatch) {
        if (currentIter) iterations.push(currentIter);
        currentIter = {
          time: parseFloat(timeMatch[1]),
          residuals: {},
          finalResiduals: {}
        };
        continue;
      }

      const resMatch = line.match(resRegex);
      if (resMatch) {
        if (!currentIter) {
          currentIter = { time: 0, residuals: {}, finalResiduals: {} };
        }
        const variable = resMatch[1];
        const initVal = parseFloat(resMatch[2]);
        const finalVal = parseFloat(resMatch[3]);
        currentIter.residuals[variable] = initVal;
        currentIter.finalResiduals[variable] = finalVal;
        monitoredVars.add(variable);
      }
    }
    if (currentIter) iterations.push(currentIter);

    const latestResiduals = iterations.length > 0 ? iterations[iterations.length - 1].residuals : {};
    const latestFinal = iterations.length > 0 ? iterations[iterations.length - 1].finalResiduals : {};
    const residualValues = Object.values(latestResiduals);
    const maxResidual = residualValues.length > 0 ? Math.max(...residualValues) : 0;
    const converged =
      iterations.length > 0 &&
      residualValues.length > 0 &&
      residualValues.every((v) => Number.isFinite(v) && v < convergenceThreshold);

    return {
      solver: 'openfoam',
      iterations,
      totalIterations: iterations.length,
      latestTime: iterations.length > 0 ? iterations[iterations.length - 1].time : null,
      latestResiduals,
      latestFinalResiduals: latestFinal,
      maxResidual,
      converged,
      monitoredVariables: Array.from(monitoredVars)
    };
  }

  // CalculiX Log Telemetry Extraction
  const stepRegex = /(?:STEP|Increment)\s+(\d+)/i;
  const iterRegex = /(?:EQUILIBRIUM ITERATION|iteration)\s+(\d+)/i;
  const timeRegex = /(?:TIME STEP\s*=\s*|TOTAL TIME\s*=\s*|TIME\s*=\s*|Time\s*=\s*)([0-9.eE+-]+)/i;
  const forceResRegex = /(?:FORCE RESIDUAL|force residual|residual force)\s*=\s*([0-9.eE+-]+)/i;
  const dispResRegex = /(?:DISPLACEMENT RESIDUAL|displacement residual|max displacement)\s*=\s*([0-9.eE+-]+)/i;
  const genericVarRegex = /(?:Residual|residual|Solving for)\s+(Ux|Uy|Uz|p|T|k|omega)\s*(?:=|:)\s*([0-9.eE+-]+)/i;

  let currentIter = null;
  let iterCounter = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const iterMatch = line.match(iterRegex);
    const stepMatch = line.match(stepRegex);
    const timeMatch = line.match(timeRegex);

    if (iterMatch || stepMatch) {
      if (currentIter && Object.keys(currentIter.residuals).length > 0) {
        iterations.push(currentIter);
      }
      iterCounter++;
      currentIter = {
        iteration: iterMatch ? parseInt(iterMatch[1], 10) : iterCounter,
        time: timeMatch ? parseFloat(timeMatch[1]) : (currentIter?.time ?? iterCounter * 0.01),
        residuals: {}
      };
    }

    if (timeMatch && currentIter) {
      currentIter.time = parseFloat(timeMatch[1]);
    }

    const forceMatch = line.match(forceResRegex);
    if (forceMatch) {
      if (!currentIter) currentIter = { iteration: ++iterCounter, time: 0.01, residuals: {} };
      const val = parseFloat(forceMatch[1]);
      currentIter.residuals.force = val;
      monitoredVars.add('force');
    }

    const dispMatch = line.match(dispResRegex);
    if (dispMatch) {
      if (!currentIter) currentIter = { iteration: ++iterCounter, time: 0.01, residuals: {} };
      const val = parseFloat(dispMatch[1]);
      currentIter.residuals.displacement = val;
      monitoredVars.add('displacement');
    }

    const varMatch = line.match(genericVarRegex);
    if (varMatch) {
      if (!currentIter) currentIter = { iteration: ++iterCounter, time: 0.01, residuals: {} };
      const variable = varMatch[1];
      const val = parseFloat(varMatch[2]);
      currentIter.residuals[variable] = val;
      monitoredVars.add(variable);
    }
  }
  if (currentIter && Object.keys(currentIter.residuals).length > 0) {
    iterations.push(currentIter);
  }

  const latestResiduals = iterations.length > 0 ? iterations[iterations.length - 1].residuals : {};
  const residualValues = Object.values(latestResiduals);
  const maxResidual = residualValues.length > 0 ? Math.max(...residualValues) : 0;
  const converged =
    iterations.length > 0 &&
    residualValues.length > 0 &&
    residualValues.every((v) => Number.isFinite(v) && v < convergenceThreshold);

  return {
    solver: isExplicitCalculix ? 'calculix' : 'unknown',
    iterations,
    totalIterations: iterations.length,
    latestTime: iterations.length > 0 ? iterations[iterations.length - 1].time : null,
    latestResiduals,
    maxResidual,
    converged,
    monitoredVariables: Array.from(monitoredVars)
  };
}

/**
 * Registers HPC domain IPC handlers.
 *
 * @param {Object} [dependencies={}] Optional dependency overrides
 */
function registerHpcIpc(dependencies = {}) {
  const clusterConfig = dependencies.clusterConfig || {};
  const gateway = new SlurmClusterGateway(clusterConfig);

  // 1. Generate Slurm / PBS Batch Script
  defineHandler(
    'hpc:generate-slurm-batch-script',
    SLURM_BATCH_SCRIPT_SCHEMA,
    async (_event, payload) => {
      const scheduler = payload.scheduler || gateway.scheduler;
      const jobName = payload.jobName || 'omnieng_sim';
      const executable = payload.executable || 'rhoCentralFoam';
      const solverType = payload.solverType || 'openfoam';
      const walltime = payload.walltime || gateway.timeLimit;
      const partition = payload.partition || gateway.partition;
      const queue = payload.queue || gateway.queue;
      const mpiBindings = payload.mpiBindings || payload.cpuBind;

      let nodes = payload.nodes;
      let ntasksPerNode = payload.ntasksPerNode;
      const requestedCores = payload.cores !== undefined ? payload.cores : payload.totalCores;

      if (nodes === undefined && ntasksPerNode === undefined && requestedCores !== undefined) {
        ntasksPerNode = Math.min(requestedCores, gateway.tasksPerNode || 64);
        nodes = Math.max(1, Math.ceil(requestedCores / ntasksPerNode));
      } else {
        nodes = nodes !== undefined ? nodes : gateway.defaultNodes;
        ntasksPerNode = ntasksPerNode !== undefined ? ntasksPerNode : gateway.tasksPerNode;
      }
      const totalCores = requestedCores !== undefined ? requestedCores : nodes * ntasksPerNode;

      const spec = {
        scheduler,
        jobName,
        solverType,
        nodes,
        ntasksPerNode,
        totalCores,
        walltime,
        executable,
        args: payload.args,
        extraArgs: payload.extraArgs,
        casePath: payload.casePath,
        outputFile: payload.outputFile,
        errorFile: payload.errorFile,
        partition,
        queue,
        mpiBindings,
        env: payload.env
      };

      const script = gateway.generateBatchScript(spec);
      const directives = gateway.parseDirectives(script, scheduler);
      const validation = gateway.validateScript(script, scheduler);

      const decomposeMethod = payload.decomposeMethod || 'scotch';
      const decomposeParDict = gateway.generateDecomposeParDict(totalCores, decomposeMethod);

      return {
        success: true,
        scheduler,
        jobName,
        script,
        directives,
        valid: validation.valid,
        missingDirectives: validation.missing,
        decomposeParDict,
        decomposeMethod,
        totalCores,
        nodes,
        ntasksPerNode,
        walltime,
        partition
      };
    },
    {
      domain: 'hpc',
      description:
        'Generates Slurm and PBS batch scripts for distributed MPI jobs scaling up to 10,000+ cores with Scotch and Metis domain decomposition'
    }
  );

  // 2. Generate OpenFOAM Case Tree
  defineHandler(
    'hpc:generate-openfoam-case',
    OPENFOAM_CASE_SCHEMA,
    async (_event, payload) => {
      const application = payload.application || payload.solver || 'rhoCentralFoam';
      const isCompressible = application === 'rhoCentralFoam';
      const subdomains =
        payload.numberOfSubdomains || payload.subdomains || payload.cores || (gateway.defaultNodes * gateway.tasksPerNode);
      const decomposeMethod = payload.decomposeMethod || 'scotch';

      const caseTree = {
        'system/controlDict': OpenFoamCaseGenerator.generateControlDict({
          application,
          startTime: payload.startTime,
          endTime: payload.endTime,
          deltaT: payload.deltaT,
          writeInterval: payload.writeInterval,
          maxCo: payload.maxCo
        }),
        'system/fvSchemes': OpenFoamCaseGenerator.generateFvSchemes({ isCompressible }),
        'system/fvSolution': OpenFoamCaseGenerator.generateFvSolution(),
        'system/blockMeshDict': OpenFoamCaseGenerator.generateBlockMeshDict({
          geometry: payload.geometry || 'channel',
          cells: payload.cells,
          dims: payload.dims
        }),
        'system/decomposeParDict': OpenFoamCaseGenerator.generateDecomposeParDict({
          numberOfSubdomains: subdomains,
          method: decomposeMethod
        }),
        'constant/transportProperties': OpenFoamCaseGenerator.generateTransportProperties({
          fluid: payload.fluid,
          geometry: payload.geometry || 'channel'
        }),
        '0/U': OpenFoamCaseGenerator.generateUField({
          inletVelocity: payload.inletVelocity || (application === 'interFoam' ? [1.5, 0, 0] : [100, 0, 0])
        })
      };

      if (payload.writeToDisk && typeof payload.casePath === 'string' && payload.casePath.trim().length > 0) {
        const resolvedBase = path.resolve(payload.casePath);
        for (const [relPath, content] of Object.entries(caseTree)) {
          const filePath = path.join(resolvedBase, relPath);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, content, 'utf8');
        }
      }

      return {
        success: true,
        solver: application,
        isCompressible,
        subdomains,
        decomposeMethod,
        files: caseTree,
        fileCount: Object.keys(caseTree).length,
        casePath: payload.writeToDisk ? payload.casePath : null
      };
    },
    {
      domain: 'hpc',
      description:
        'Generates complete OpenFOAM case decks for compressible shock CFD and interFoam VOF multiphase analysis'
    }
  );

  // 3. Generate CalculiX Case Deck
  defineHandler(
    'hpc:generate-calculix-case',
    CALCULIX_CASE_SCHEMA,
    async (_event, payload) => {
      const defaultNodes = [
        [1, 0, 0, 0],
        [2, 10, 0, 0],
        [3, 10, 10, 0],
        [4, 0, 10, 0],
        [5, 0, 0, 10],
        [6, 10, 0, 10],
        [7, 10, 10, 10],
        [8, 0, 10, 10]
      ];
      const defaultElements = [[1, 1, 2, 3, 4, 5, 6, 7, 8]];
      const defaultNodeSets = {
        NFIX: [1, 2, 3, 4],
        NLOAD: [7, 8]
      };
      const defaultBoundary = [{ set: 'NFIX', dofs: [1, 3], value: 0 }];
      const defaultLoads = [{ set: 'NLOAD', dof: 2, magnitude: -5000 }];

      const nodes = payload.nodes || defaultNodes;
      const elements = payload.elements || defaultElements;
      const nodeSets = payload.nodeSets || defaultNodeSets;
      const boundaryConditions = payload.boundaryConditions || defaultBoundary;
      const appliedLoads = payload.appliedLoads || defaultLoads;

      const deck = CalculixCaseGenerator.generateInputDeck({
        heading: payload.heading || 'CalculiX FEA Simulation',
        nodes,
        elements,
        elementType: payload.elementType || 'C3D8',
        materialName: payload.materialName || 'STEEL',
        youngsModulus_MPa: payload.youngsModulus_MPa !== undefined ? payload.youngsModulus_MPa : 210000,
        poissonsRatio: payload.poissonsRatio !== undefined ? payload.poissonsRatio : 0.3,
        yieldStress_MPa: payload.yieldStress_MPa !== undefined ? payload.yieldStress_MPa : null,
        hardeningStrain: payload.hardeningStrain !== undefined ? payload.hardeningStrain : 0.15,
        density_kg_m3: payload.density_kg_m3 !== undefined ? payload.density_kg_m3 : null,
        nodeSets,
        boundaryConditions,
        appliedLoads,
        isNonLinearGeom: Boolean(payload.isNonLinearGeom),
        stepType: payload.stepType || 'STATIC'
      });

      const parsed = CalculixCaseGenerator.parseDeck(deck);

      if (payload.writeToDisk && typeof payload.casePath === 'string' && payload.casePath.trim().length > 0) {
        const filePath = path.resolve(payload.casePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, deck, 'utf8');
      }

      return {
        success: true,
        heading: payload.heading || 'CalculiX FEA Simulation',
        deck,
        parsed,
        nodeCount: nodes.length,
        elementCount: elements.length,
        elementType: payload.elementType || 'C3D8',
        materialName: payload.materialName || 'STEEL',
        yieldStress_MPa: payload.yieldStress_MPa || null,
        isPlastic: Boolean(payload.yieldStress_MPa),
        isNonLinearGeom: Boolean(payload.isNonLinearGeom),
        stepType: payload.stepType || 'STATIC',
        casePath: payload.writeToDisk ? payload.casePath : null
      };
    },
    {
      domain: 'hpc',
      description:
        'Generates CalculiX FEA input decks (.inp) for non-linear plastic continuum mechanics and dynamic explicit analysis'
    }
  );

  // 4. Parse Solver Log Stream Telemetry
  defineHandler(
    'hpc:parse-solver-telemetry',
    SOLVER_TELEMETRY_SCHEMA,
    async (_event, payload) => {
      const logContent = payload.logContent;
      const solver = payload.solver || 'auto';
      const convergenceThreshold = payload.convergenceThreshold || 1e-3;

      const telemetry = parseSolverTelemetry(logContent, solver, convergenceThreshold);

      return {
        success: true,
        ...telemetry
      };
    },
    {
      domain: 'hpc',
      description:
        'Parses live OpenFOAM and CalculiX solver log streams and extracts convergence residuals for Ux, Uy, Uz, p, T, k, and omega'
    }
  );
}

module.exports = {
  registerHpcIpc,
  parseSolverTelemetry,
  SLURM_BATCH_SCRIPT_SCHEMA,
  OPENFOAM_CASE_SCHEMA,
  CALCULIX_CASE_SCHEMA,
  SOLVER_TELEMETRY_SCHEMA
};
