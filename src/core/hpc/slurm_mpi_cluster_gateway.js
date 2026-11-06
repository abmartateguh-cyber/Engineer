/**
 * slurm_mpi_cluster_gateway.js
 *
 * Headless HPC job-submission gateway. Generates Slurm (#SBATCH) and PBS
 * (#PBS) batch scripts for distributed MPI jobs, and provides a deterministic
 * dry-run "submit" path that validates generated scripts without contacting a
 * cluster. Pure text generation, no external dependencies.
 */

'use strict';

const REQUIRED_SLURM_DIRECTIVES = ['job-name', 'output', 'error', 'partition', 'nodes', 'ntasks-per-node', 'time'];

const REQUIRED_PBS_DIRECTIVES = ['job-name', 'output', 'error', 'queue', 'nodes', 'ppn', 'walltime'];

const VALID_SOLVER_TYPES = new Set(['openfoam', 'calculix', 'custom']);

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got ${JSON.stringify(value)}`);
  }
}

function assertWalltimeFormat(value) {
  if (typeof value !== 'string' || !/^\d{1,2}:\d{2}:\d{2}$/.test(value)) {
    throw new Error(`walltime must be a string in HH:MM:SS format, got ${JSON.stringify(value)}`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
}

class SlurmClusterGateway {
  constructor(clusterConfig = {}) {
    this.clusterName = clusterConfig.clusterName || 'HPC-Engineering-Cluster';
    this.scheduler = clusterConfig.scheduler === 'pbs' ? 'pbs' : 'slurm';
    this.partition = clusterConfig.partition || 'compute';
    this.queue = clusterConfig.queue || 'workq';
    this.defaultNodes = clusterConfig.defaultNodes || 16;
    this.tasksPerNode = clusterConfig.tasksPerNode || 64;
    this.timeLimit = clusterConfig.timeLimit || '24:00:00';
    this.modulesToLoad = Array.isArray(clusterConfig.modules)
      ? clusterConfig.modules.slice()
      : ['openmpi/4.1.5', 'openfoam/v2312', 'calculix/2.21'];
    this.jobs = new Map();
  }

  /**
   * Generates a Slurm (#SBATCH) or PBS (#PBS) batch script for an MPI job.
   *
   * spec fields:
   *   scheduler       'slurm' (default) | 'pbs'
   *   jobName         string
   *   solverType      'openfoam' | 'calculix' | 'custom'
   *   nodes           positive integer
   *   ntasksPerNode   positive integer
   *   cores / totalCores  total MPI ranks (defaults to nodes * ntasksPerNode)
   *   walltime        HH:MM:SS
   *   executable      launcher target
   *   args            extra launcher arguments (openfoam defaults to -parallel)
   *   env             object of variables to export
   *   outputFile / errorFile
   *   casePath        working directory
   */
  generateBatchScript(spec = {}) {
    const scheduler = spec.scheduler || this.scheduler;
    const jobName = spec.jobName || 'omnieng_sim';
    const nodes = spec.nodes !== undefined ? spec.nodes : this.defaultNodes;
    const ntasksPerNode = spec.ntasksPerNode !== undefined ? spec.ntasksPerNode : this.tasksPerNode;
    const totalCores =
      spec.cores !== undefined ? spec.cores : spec.totalCores !== undefined ? spec.totalCores : nodes * ntasksPerNode;
    const walltime = spec.walltime || this.timeLimit;
    const executable = spec.executable || 'rhoCentralFoam';
    const solverType = spec.solverType || 'openfoam';
    const args =
      spec.args !== undefined
        ? spec.args
        : spec.extraArgs !== undefined
          ? spec.extraArgs
          : solverType === 'openfoam'
            ? '-parallel'
            : '';
    const outputFile = spec.outputFile || `${jobName}_%j.log`;
    const errorFile = spec.errorFile || `${jobName}_%j.err`;
    const env = spec.env || {};
    const casePath = spec.casePath || './case';

    const partition = spec.partition || this.partition;
    const queue = spec.queue || this.queue;
    const mpiBindings = spec.mpiBindings || spec.cpuBind;
    const srunBindings = mpiBindings ? `--cpu-bind=${mpiBindings} ` : '';
    const pbsBindings = mpiBindings ? `--bind-to ${mpiBindings} ` : '';

    assertPositiveInteger(nodes, 'nodes');
    assertPositiveInteger(ntasksPerNode, 'ntasksPerNode');
    assertPositiveInteger(totalCores, 'cores');
    assertWalltimeFormat(walltime);
    assertNonEmptyString(executable, 'executable');
    assertNonEmptyString(jobName, 'jobName');
    assertNonEmptyString(outputFile, 'outputFile');
    assertNonEmptyString(errorFile, 'errorFile');
    if (!VALID_SOLVER_TYPES.has(solverType)) {
      throw new Error(`Unknown solverType "${solverType}"; expected one of ${[...VALID_SOLVER_TYPES].join(', ')}`);
    }

    const moduleLines = this.modulesToLoad.map((m) => `module load ${m}`);
    const envLines = Object.entries(env).map(([k, v]) => `export ${k}=${v}`);
    const preamble = [
      '#!/bin/bash',
      '',
      '# Load environment modules',
      ...moduleLines,
      '',
      ...envLines,
      '',
      'echo "Job started on $(hostname) at $(date)"',
      `echo "Allocated ${totalCores} MPI ranks across ${nodes} nodes"`,
      '',
      `cd "${casePath}" || exit 1`
    ];

    if (scheduler === 'pbs') {
      const body = [];
      if (solverType === 'openfoam') {
        body.push(
          '# Decompose mesh if not already decomposed',
          'if [ ! -d "processor0" ]; then',
          '    echo "Executing domain decomposition via decomposePar..."',
          '    decomposePar -force',
          'fi',
          '',
          '# Execute distributed OpenFOAM MPI solve',
          `mpirun ${pbsBindings}-np ${totalCores} ${executable} ${args} > log.${executable} 2>&1`,
          '',
          '# Reconstruct domain after completion',
          'reconstructPar -latestTime'
        );
      } else if (solverType === 'calculix') {
        body.push(
          '# Execute parallel CalculiX CCX solve',
          `export OMP_NUM_THREADS=${ntasksPerNode}`,
          `mpirun ${pbsBindings}-np ${totalCores} ccx_2.21 -i "${jobName}"`
        );
      } else {
        body.push(`mpirun ${pbsBindings}-np ${totalCores} ${executable} ${args}`.trim());
      }
      return [
        ...preamble.slice(0, 1),
        `#PBS -N ${jobName}`,
        `#PBS -o ${outputFile}`,
        `#PBS -e ${errorFile}`,
        `#PBS -q ${queue}`,
        `#PBS -l nodes=${nodes}:ppn=${ntasksPerNode}`,
        `#PBS -l walltime=${walltime}`,
        '#PBS -V',
        ...preamble.slice(1),
        ...body
      ].join('\n');
    }

    const body = [];
    if (solverType === 'openfoam') {
      body.push(
        '# Decompose mesh if not already decomposed',
        'if [ ! -d "processor0" ]; then',
        '    echo "Executing domain decomposition via decomposePar..."',
        '    decomposePar -force',
        'fi',
        '',
        '# Execute distributed OpenFOAM MPI solve',
        `srun --mpi=pmix ${srunBindings}-n ${totalCores} ${executable} ${args} > log.${executable} 2>&1`,
        '',
        '# Reconstruct domain after completion',
        'reconstructPar -latestTime'
      );
    } else if (solverType === 'calculix') {
      body.push(
        '# Execute parallel CalculiX CCX solve',
        `export OMP_NUM_THREADS=${ntasksPerNode}`,
        `srun --mpi=pmix ${srunBindings}-n ${totalCores} ccx_2.21 -i "${jobName}"`
      );
    } else {
      body.push(`srun --mpi=pmix ${srunBindings}-n ${totalCores} ${executable} ${args}`.trim());
    }

    return [
      ...preamble.slice(0, 1),
      `#SBATCH --job-name=${jobName}`,
      `#SBATCH --output=${outputFile}`,
      `#SBATCH --error=${errorFile}`,
      `#SBATCH --partition=${partition}`,
      `#SBATCH --nodes=${nodes}`,
      `#SBATCH --ntasks-per-node=${ntasksPerNode}`,
      `#SBATCH --time=${walltime}`,
      '#SBATCH --exclusive',
      ...(mpiBindings ? [`#SBATCH --cpu-bind=${mpiBindings}`] : []),
      ...preamble.slice(1),
      ...body
    ].join('\n');
  }

  /**
   * Parses #SBATCH / #PBS directives from a generated script into a key-value map.
   */
  parseDirectives(script, scheduler) {
    const sched = scheduler || this.scheduler;
    const prefix = sched === 'pbs' ? '#PBS' : '#SBATCH';
    const directives = {};

    for (const rawLine of String(script).split('\n')) {
      const line = rawLine.trim();
      if (!line.startsWith(prefix)) continue;
      const body = line.slice(prefix.length).trim();

      if (sched === 'slurm') {
        const m = body.match(/^--([A-Za-z0-9_-]+)=(\S+)$/);
        if (m) directives[m[1]] = m[2];
        continue;
      }

      const single = body.match(/^-([A-Za-z])\s+(\S+)$/);
      if (!single) continue;
      const flag = single[1];
      const value = single[2];
      if (flag === 'l') {
        for (const pair of value.split(',')) {
          const eq = pair.indexOf('=');
          if (eq <= 0) continue;
          const key = pair.slice(0, eq).trim();
          const rest = pair.slice(eq + 1);
          if (key === 'nodes') {
            const parts = rest.split(':');
            directives.nodes = parts[0].trim();
            for (let i = 1; i < parts.length; i++) {
              const sub = parts[i].trim();
              const subEq = sub.indexOf('=');
              if (subEq > 0) {
                directives[sub.slice(0, subEq).trim()] = sub.slice(subEq + 1).trim();
              } else if (sub) {
                directives[sub] = '';
              }
            }
          } else {
            directives[key] = rest.trim();
          }
        }
      } else if (flag === 'N') {
        directives['job-name'] = value;
      } else if (flag === 'o') {
        directives.output = value;
      } else if (flag === 'e') {
        directives.error = value;
      } else if (flag === 'q') {
        directives.queue = value;
      } else {
        directives[flag] = value;
      }
    }
    return directives;
  }

  /**
   * Validates that a script contains every required directive for its scheduler.
   * Returns { valid, directives, missing }.
   */
  validateScript(script, scheduler) {
    const sched = scheduler || this.scheduler;
    const required = sched === 'pbs' ? REQUIRED_PBS_DIRECTIVES : REQUIRED_SLURM_DIRECTIVES;
    const directives = this.parseDirectives(script, sched);
    const missing = required.filter((k) => !(k in directives));
    return { valid: missing.length === 0, directives, missing };
  }

  /**
   * Dry-run submit: generates and validates the batch script without contacting
   * any cluster. Throws if required directives are missing from the output.
   */
  dryRunSubmit(spec = {}) {
    const script = this.generateBatchScript(spec);
    const scheduler = spec.scheduler || this.scheduler;
    const { valid, directives, missing } = this.validateScript(script, scheduler);
    if (!valid) {
      throw new Error(`Generated ${scheduler} script missing required directives: ${missing.join(', ')}`);
    }
    return {
      valid: true,
      scheduler,
      script,
      directives,
      missing: []
    };
  }

  /**
   * Generates a Scotch / METIS domain decomposition dictionary for OpenFOAM.
   */
  generateDecomposeParDict(numSubdomains, method = 'scotch') {
    assertPositiveInteger(numSubdomains, 'numSubdomains');
    return [
      '/*--------------------------------*- C++ -*----------------------------------*\\',
      '| =========                 |                                                 |',
      '| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |',
      '|  \\\\    /   O peration     | Version:  v2312                                 |',
      '|   \\\\  /    A nd           | Website:  www.openfoam.com                      |',
      '|    \\\\/     M anipulation  |                                                 |',
      '\\*---------------------------------------------------------------------------*/',
      'FoamFile',
      '{',
      '    version     2.0;',
      '    format      ascii;',
      '    class       dictionary;',
      '    location    "system";',
      '    object      decomposeParDict;',
      '}',
      '// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //',
      '',
      `numberOfSubdomains ${numSubdomains};`,
      '',
      `method          ${method};`,
      '',
      '// ************************************************************************* //'
    ].join('\n');
  }

  /**
   * Submits a simulation job to the queue and tracks state (simulated).
   */
  submitJob(jobParams) {
    const jobId = `HPC-${Math.floor(100000 + Math.random() * 900000)}`;
    const batchScript = this.generateBatchScript(jobParams);
    const record = {
      jobId,
      jobName: jobParams.jobName || 'sim_run',
      status: 'SUBMITTED',
      nodes: jobParams.nodes || this.defaultNodes,
      cores: (jobParams.nodes || this.defaultNodes) * (jobParams.ntasksPerNode || this.tasksPerNode),
      submittedAt: new Date().toISOString(),
      scriptPreview: batchScript
    };
    this.jobs.set(jobId, record);
    return record;
  }

  /**
   * Parses live residual log stream from OpenFOAM solvers.
   */
  parseResiduals(logContent) {
    const lines = logContent.split('\n');
    const iterations = [];
    let currentIter = null;

    const timeRegex = /^Time\s*=\s*([0-9.eE+-]+)/;
    const residualRegex =
      /Solving for (Ux|Uy|Uz|p|h|e|k|omega|T),\s*Initial residual\s*=\s*([0-9.eE+-]+),\s*Final residual\s*=\s*([0-9.eE+-]+)/;

    for (const line of lines) {
      const timeMatch = line.match(timeRegex);
      if (timeMatch) {
        if (currentIter) iterations.push(currentIter);
        currentIter = { time: parseFloat(timeMatch[1]), residuals: {} };
        continue;
      }

      const resMatch = line.match(residualRegex);
      if (resMatch && currentIter) {
        const variable = resMatch[1];
        const initialResidual = parseFloat(resMatch[2]);
        currentIter.residuals[variable] = initialResidual;
      }
    }
    if (currentIter) iterations.push(currentIter);

    return iterations;
  }
}

let instance = null;
function getSlurmGateway(config) {
  if (!instance) {
    instance = new SlurmClusterGateway(config);
  }
  return instance;
}

module.exports = {
  SlurmClusterGateway,
  getSlurmGateway,
  REQUIRED_SLURM_DIRECTIVES,
  REQUIRED_PBS_DIRECTIVES
};
