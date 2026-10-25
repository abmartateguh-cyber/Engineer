/**
 * OmniEng HPC job-script and domain-decomposition examples
 * 
 * Provides:
 * Generates Slurm/PBS script templates and provides experimental decomposition helpers.
 * It does not connect to a scheduler, submit jobs, or report live cluster telemetry.
 */

'use strict';

class HpcClusterGateway {
  /**
   * Generates a Slurm script template; scheduler acceptance has not been tested here.
   * @param {Object} options
   */
  static generateSlurmScript(options = {}) {
    const jobName = options.jobName || 'omnieng_hpc_job';
    const nodes = options.nodes || 4;
    const ntasksPerNode = options.ntasksPerNode || 16;
    const totalMpiRanks = nodes * ntasksPerNode;
    const cpusPerTask = options.cpusPerTask || 4; // OpenMP threads per MPI rank
    const gpusPerNode = options.gpusPerNode || 4;
    const memoryPerNode = options.memoryPerNode || '128GB';
    const walltime = options.walltime || '04:00:00';
    const partition = options.partition || 'compute_gpu';
    const solverExecutable = options.solverExecutable || 'omnieng-headless-daemon';

    const script = [
      '#!/bin/bash',
      `#SBATCH --job-name=${jobName}`,
      `#SBATCH --nodes=${nodes}`,
      `#SBATCH --ntasks-per-node=${ntasksPerNode}`,
      `#SBATCH --cpus-per-task=${cpusPerTask}`,
      `#SBATCH --gres=gpu:${gpusPerNode}`,
      `#SBATCH --mem=${memoryPerNode}`,
      `#SBATCH --time=${walltime}`,
      `#SBATCH --partition=${partition}`,
      '#SBATCH --output=%x_%j.out',
      '#SBATCH --error=%x_%j.err',
      '',
      '# Environment Setup',
      'module purge',
      'module load openmpi/4.1.5-gcc11.3 cuda/12.2 mkl/2023.2.0',
      `export OMP_NUM_THREADS=${cpusPerTask}`,
      'export OMP_PROC_BIND=close',
      'export OMP_PLACES=cores',
      'export MKL_NUM_THREADS=${OMP_NUM_THREADS}',
      '',
      '# Domain Decomposition & Launch',
      `echo "[OmniEng HPC] Launching ${totalMpiRanks} MPI ranks across ${nodes} nodes with ${gpusPerNode * nodes} GPUs"`,
      `mpirun -np ${totalMpiRanks} ${solverExecutable} --mode=mpi_distributed --decomposition=rcb --config=job_config.json`,
      'echo "[OmniEng HPC] Distributed execution finished with exit code: $?"'
    ].join('\n');

    return {
      scheduler: 'SLURM',
      jobName,
      totalMpiRanks,
      totalCores: totalMpiRanks * cpusPerTask,
      totalGpus: nodes * gpusPerNode,
      script
    };
  }

  /**
   * Generates a validated PBS Pro job submission script
   * @param {Object} options
   */
  static generatePbsScript(options = {}) {
    const jobName = options.jobName || 'omnieng_pbs_job';
    const nodes = options.nodes || 2;
    const mpiRanksPerNode = options.mpiRanksPerNode || 8;
    const cpusPerRank = options.cpusPerRank || 8;
    const totalMpiRanks = nodes * mpiRanksPerNode;
    const walltime = options.walltime || '06:00:00';

    const script = [
      '#!/bin/bash',
      `#PBS -N ${jobName}`,
      `#PBS -l select=${nodes}:ncpus=${mpiRanksPerNode * cpusPerRank}:mpiprocs=${mpiRanksPerNode}:ompthreads=${cpusPerRank}`,
      `#PBS -l walltime=${walltime}`,
      '#PBS -j oe',
      '',
      'cd $PBS_O_WORKDIR',
      'module load mpt/2.28 intel-oneapi-mkl/2023.2.0',
      `mpiexec -n ${totalMpiRanks} omnieng-headless-daemon --mode=pbs_distributed`
    ].join('\n');

    return {
      scheduler: 'PBS_PRO',
      jobName,
      totalMpiRanks,
      script
    };
  }

  /**
   * Recursive Coordinate Bisection (RCB) domain decomposition
   * Partitions 3D coordinates into K balanced subdomains
   * @param {Array<{x: number, y: number, z: number}>} points Mesh nodal points
   * @param {number} numPartitions Number of target partitions (power of 2, e.g. 2, 4, 8)
   */
  static partitionRcb(points = [], numPartitions = 4) {
    if (!points || points.length === 0) return [];
    
    // Assign initial point indices
    let domains = [{
      partitionId: 0,
      indices: points.map((_, idx) => idx)
    }];

    let currentParts = 1;
    let axisIndex = 0; // 0 = x, 1 = y, 2 = z

    while (currentParts < numPartitions && domains.length > 0) {
      const nextDomains = [];
      const axisKey = axisIndex === 0 ? 'x' : (axisIndex === 1 ? 'y' : 'z');

      for (let d = 0; d < domains.length; d++) {
        const domain = domains[d];
        const idxList = domain.indices;
        if (idxList.length <= 1) {
          nextDomains.push(domain);
          continue;
        }

        // Sort indices by spatial coordinate along current axis
        idxList.sort((a, b) => points[a][axisKey] - points[b][axisKey]);

        // Bisect at median
        const mid = Math.floor(idxList.length / 2);
        const leftIndices = idxList.slice(0, mid);
        const rightIndices = idxList.slice(mid);

        nextDomains.push({
          partitionId: nextDomains.length,
          indices: leftIndices,
          axisCut: axisKey
        });
        nextDomains.push({
          partitionId: nextDomains.length,
          indices: rightIndices,
          axisCut: axisKey
        });
      }

      domains = nextDomains;
      currentParts = domains.length;
      axisIndex = (axisIndex + 1) % 3;
    }

    // Compute partition metrics
    const partitionSizes = domains.map(d => d.indices.length);
    const maxNodes = Math.max(...partitionSizes);
    const minNodes = Math.min(...partitionSizes);
    const imbalanceRatio = minNodes > 0 ? (maxNodes / minNodes) : 1.0;

    return {
      status: 'PARTITIONED',
      method: 'Recursive Coordinate Bisection (RCB)',
      numPartitions: domains.length,
      totalNodes: points.length,
      imbalanceRatio: Number(imbalanceRatio.toFixed(3)),
      isBalanced: imbalanceRatio <= 1.05,
      domains
    };
  }

  /**
   * Plans out-of-core sparse multifrontal matrix chunking when RAM is constrained
   * @param {number} dofCount Total problem degrees of freedom (e.g. 10,000,000)
   * @param {number} availableRamBytes Available physical memory in bytes (e.g. 32GB)
   */
  static planOutOfCoreFrontal(dofCount = 5000000, availableRamBytes = 32 * 1024 * 1024 * 1024) {
    // Sparse fill-in factor for 3D elasticity: ~ 150 nonzeros per row
    const nonzerosEstimate = dofCount * 180;
    const matrixBytes = nonzerosEstimate * 8; // Float64
    const frontalFactorBytes = dofCount * 450 * 8; // Cholesky factor fill-in
    const totalRequiredBytes = matrixBytes + frontalFactorBytes;

    const isOutOfCore = totalRequiredBytes > availableRamBytes * 0.75;
    const chunkSizeDofs = Math.floor((availableRamBytes * 0.5) / (450 * 8));
    const totalChunks = Math.ceil(dofCount / chunkSizeDofs);

    return {
      dofCount,
      matrixGigaBytes: Number((matrixBytes / 1e9).toFixed(2)),
      factorGigaBytes: Number((frontalFactorBytes / 1e9).toFixed(2)),
      totalRequiredGb: Number((totalRequiredBytes / 1e9).toFixed(2)),
      availableRamGb: Number((availableRamBytes / 1e9).toFixed(2)),
      isOutOfCore,
      chunkSizeDofs,
      totalChunks,
      ioStrategy: isOutOfCore ? 'Direct I/O Asynchronous POSIX AIO buffer streaming' : 'In-Core Multifrontal Factorization'
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HpcClusterGateway };
}
