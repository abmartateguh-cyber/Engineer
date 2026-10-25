/**
 * Experimental PDN arithmetic for caller-supplied electrical inputs.
 *
 * The mesh calculation solves a lumped resistor network. It does not model a
 * foundry stack, package, decoupling network, or signoff limits. Black's equation
 * uses caller-supplied coefficients and is an unverified estimate.
 */

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be a finite number.`);
}

function requirePositive(value, label) {
  requireFinite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero.`);
}

function requireNonNegative(value, label) {
  requireFinite(value, label);
  if (value < 0) throw new RangeError(`${label} must not be negative.`);
}

class PowerGridIRDropAnalyzer {
  /**
   * @param {Object} options
   * @param {number} options.vdd - Caller-supplied nominal supply voltage (V)
   * @param {number} options.maxDropThresholdPercent - Caller-supplied comparison threshold (%)
   * @param {number} options.metalThickness - Caller-supplied conductor thickness (m)
   */
  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('PDN analyzer options must be an object.');
    }
    this.vdd = options.vdd;
    this.maxDropThresholdPercent = options.maxDropThresholdPercent;
    // Accept the old property name as an explicit input for existing callers.
    this.metalThickness = options.metalThickness ?? options.defaultMetalThickness;
  }

  /**
   * Resolves the in-house sparse Cholesky class (Node require or browser global).
   */
  static _sparseSolverClass() {
    if (typeof require !== 'undefined') {
      return require('../math/wasm_sparse_multifrontal').WasmSparseMultifrontalSolver;
    }
    if (typeof window !== 'undefined' && window.WasmSparseMultifrontalSolver) {
      return window.WasmSparseMultifrontalSolver;
    }
    throw new Error('Sparse solver (wasm_sparse_multifrontal.js) is not loaded');
  }

  /**
   * Create an N x M rectangular resistor-grid input.
   *
   * @param {number} rows - Number of grid rows
   * @param {number} cols - Number of grid columns
   * @param {number} pitchX - Caller-supplied horizontal wire pitch (m)
   * @param {number} pitchY - Caller-supplied vertical wire pitch (m)
   * @param {number} sheetRho - Caller-supplied sheet resistance (Ohms/square)
   * @param {number} wireWidth - Caller-supplied wire width (m)
   * @returns {Object} Grid topology with nodes and resistors
   */
  createGridMesh(rows, cols, pitchX, pitchY, sheetRho, wireWidth) {
    if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(cols) || cols < 1) {
      throw new RangeError('PDN mesh rows and columns must be positive integers.');
    }
    requirePositive(this.vdd, 'vdd');
    requirePositive(pitchX, 'pitchX');
    requirePositive(pitchY, 'pitchY');
    requirePositive(sheetRho, 'sheetRho');
    requirePositive(wireWidth, 'wireWidth');
    const numNodes = rows * cols;
    const rHoriz = sheetRho * (pitchX / wireWidth);
    const rVert = sheetRho * (pitchY / wireWidth);
    if (!Number.isSafeInteger(numNodes)) throw new RangeError('PDN mesh size is outside the supported integer range.');
    requirePositive(rHoriz, 'horizontal wire resistance');
    requirePositive(rVert, 'vertical wire resistance');

    const nodes = [];
    const resistors = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const id = r * cols + c;
        nodes.push({
          id,
          row: r,
          col: c,
          x: c * pitchX,
          y: r * pitchY,
          isPad: false,
          currentLoad: 0.0, // Amperes drawn by active logic gates
          voltage: this.vdd,
          irDrop: 0.0
        });

        // Horizontal resistor to right neighbor
        if (c < cols - 1) {
          resistors.push({
            nodeA: id,
            nodeB: id + 1,
            resistance: rHoriz,
            conductance: 1.0 / rHoriz,
            current: 0.0,
            direction: 'H'
          });
        }

        // Vertical resistor to bottom neighbor
        if (r < rows - 1) {
          resistors.push({
            nodeA: id,
            nodeB: id + cols,
            resistance: rVert,
            conductance: 1.0 / rVert,
            current: 0.0,
            direction: 'V'
          });
        }
      }
    }

    return {
      rows,
      cols,
      numNodes,
      pitchX,
      pitchY,
      sheetRho,
      wireWidth,
      nodes,
      resistors,
      dataStatus: 'caller-supplied-unverified'
    };
  }

  /**
   * Solves static IR drop by constructing and solving G * V = I.
   * Node voltages at C4/Vip pads are fixed to Vdd (Dirichlet boundary).
   *
   * @param {Object} mesh - Created grid mesh
   * @param {Array<number>} padNodeIds - IDs of power bump/pad nodes connected to external supply
   * @param {Array<{nodeId: number, current: number}>} currentLoads - Caller-supplied current sinks (A)
   * @returns {Object} Experimental lumped-network values and comparison with the supplied threshold
   */
  solveStaticIRDrop(mesh, padNodeIds, currentLoads) {
    requirePositive(this.vdd, 'vdd');
    requireNonNegative(this.maxDropThresholdPercent, 'maxDropThresholdPercent');
    requirePositive(this.metalThickness, 'metalThickness');
    if (
      !mesh ||
      !Number.isInteger(mesh.numNodes) ||
      mesh.numNodes < 1 ||
      !Array.isArray(mesh.nodes) ||
      !Array.isArray(mesh.resistors)
    ) {
      throw new TypeError('A valid caller-supplied PDN mesh is required.');
    }
    const N = mesh.numNodes;
    if (mesh.nodes.length !== N || !Number.isFinite(mesh.wireWidth) || mesh.wireWidth <= 0) {
      throw new TypeError('PDN mesh node count and wire width must be valid.');
    }
    if (!mesh.nodes.every((node, index) => node && node.id === index)) {
      throw new TypeError('PDN mesh node IDs must match their array positions.');
    }
    if (
      !Array.isArray(padNodeIds) ||
      padNodeIds.length === 0 ||
      !padNodeIds.every((id) => Number.isInteger(id) && id >= 0 && id < N)
    ) {
      throw new TypeError('At least one valid caller-supplied supply pad node is required.');
    }
    if (new Set(padNodeIds).size !== padNodeIds.length) throw new TypeError('Supply pad node IDs must be unique.');
    if (!Array.isArray(currentLoads)) throw new TypeError('Caller-supplied current loads are required as an array.');
    for (const load of currentLoads) {
      if (!load || !Number.isInteger(load.nodeId) || load.nodeId < 0 || load.nodeId >= N) {
        throw new TypeError('Each current load must contain a valid nodeId.');
      }
      requireNonNegative(load.current, 'load current');
    }
    for (const resistor of mesh.resistors) {
      if (
        !resistor ||
        !Number.isInteger(resistor.nodeA) ||
        !Number.isInteger(resistor.nodeB) ||
        resistor.nodeA < 0 ||
        resistor.nodeA >= N ||
        resistor.nodeB < 0 ||
        resistor.nodeB >= N ||
        resistor.nodeA === resistor.nodeB
      ) {
        throw new TypeError('Each mesh resistor must connect two distinct valid nodes.');
      }
      requirePositive(resistor.resistance, 'resistor resistance');
      requirePositive(resistor.conductance, 'resistor conductance');
      if (Math.abs(resistor.conductance * resistor.resistance - 1) > 1e-8) {
        throw new TypeError('Each mesh resistor conductance must be the reciprocal of its resistance.');
      }
    }
    const padSet = new Set(padNodeIds);

    // Reset loads
    mesh.nodes.forEach((n) => {
      n.currentLoad = 0.0;
      n.isPad = padSet.has(n.id);
    });

    currentLoads.forEach((ld) => {
      mesh.nodes[ld.nodeId].currentLoad += ld.current;
    });

    // Formulate G * V = I on the reduced (non-pad) unknowns:
    // pads are Dirichlet V = Vdd and are eliminated from the system; each resistor
    // between a free node and a pad contributes g to the diagonal and g*Vdd to the RHS.
    // The reduced matrix is symmetric positive definite and is solved with the
    // in-house sparse Cholesky (O(nnz(L)) memory instead of a dense N x N matrix).
    const freeIdx = new Int32Array(N).fill(-1);
    let nFree = 0;
    for (let i = 0; i < N; i++) {
      if (!padSet.has(i)) freeIdx[i] = nFree++;
    }
    const V = new Float64Array(N);
    for (let i = 0; i < N; i++) V[i] = padSet.has(i) ? this.vdd : 0.0;

    let residualNorm = 0;
    if (nFree > 0) {
      const SparseSolver = PowerGridIRDropAnalyzer._sparseSolverClass();
      const solver = new SparseSolver(nFree, nFree);
      const b = new Float64Array(nFree);
      for (let i = 0; i < N; i++) {
        if (freeIdx[i] >= 0) b[freeIdx[i]] = -mesh.nodes[i].currentLoad;
      }
      for (const res of mesh.resistors) {
        const fu = freeIdx[res.nodeA];
        const fv = freeIdx[res.nodeB];
        const g = res.conductance;
        if (fu >= 0) solver.addEntry(fu, fu, g);
        if (fv >= 0) solver.addEntry(fv, fv, g);
        if (fu >= 0 && fv >= 0) {
          solver.addEntry(fu, fv, -g);
          solver.addEntry(fv, fu, -g);
        } else if (fu >= 0) {
          b[fu] += g * this.vdd;
        } else if (fv >= 0) {
          b[fv] += g * this.vdd;
        }
      }

      solver.finalizeCSR();
      const solved = solver.solve(b);
      if (
        !solved.converged ||
        !Number.isFinite(solved.residualNorm) ||
        !Array.from(solved.solution).every(Number.isFinite)
      ) {
        throw new Error('PDN sparse solve did not produce a finite solution with an acceptable residual.');
      }
      residualNorm = solved.residualNorm;
      for (let i = 0; i < N; i++) {
        if (freeIdx[i] >= 0) V[i] = solved.solution[freeIdx[i]];
      }
    }

    let minVoltage = Infinity;
    let maxDrop = 0.0;
    let worstNodeId = -1;

    for (let i = 0; i < N; i++) {
      mesh.nodes[i].voltage = V[i];
      const drop = this.vdd - V[i];
      mesh.nodes[i].irDrop = Math.max(0.0, drop);

      if (V[i] < minVoltage) {
        minVoltage = V[i];
        maxDrop = drop;
        worstNodeId = i;
      }
    }

    // Compute branch currents and current densities
    let maxCurrentDensity = 0.0; // A / cm^2
    for (const res of mesh.resistors) {
      const vA = mesh.nodes[res.nodeA].voltage;
      const vB = mesh.nodes[res.nodeB].voltage;
      res.current = Math.abs(vA - vB) / res.resistance;

      // Cross-sectional area = width * thickness (m^2)
      // Convert to cm^2 (1 m^2 = 1e4 cm^2)
      const areaCm2 = mesh.wireWidth * this.metalThickness * 1.0e4;
      requirePositive(areaCm2, 'conductor cross-sectional area');
      res.currentDensity = res.current / areaCm2; // A / cm^2
      requireFinite(res.currentDensity, 'branch current density');

      if (res.currentDensity > maxCurrentDensity) {
        maxCurrentDensity = res.currentDensity;
      }
    }

    const dropPercent = (maxDrop / this.vdd) * 100.0;
    const belowSuppliedThreshold = dropPercent <= this.maxDropThresholdPercent;
    const totalCurrentDrawn = currentLoads.reduce((acc, load) => acc + load.current, 0.0);
    requireFinite(totalCurrentDrawn, 'total current draw');

    return {
      minVoltage,
      maxDrop,
      dropPercent,
      worstNodeId,
      maxCurrentDensity,
      thresholdComparison: belowSuppliedThreshold ? 'below-supplied-threshold' : 'above-supplied-threshold',
      belowSuppliedThreshold,
      // Legacy compatibility alias; this compares only with the caller's threshold.
      passesThreshold: belowSuppliedThreshold,
      totalCurrentDrawn,
      residualNorm: nFree > 0 ? residualNorm : 0,
      dataStatus: 'caller-supplied-unverified',
      validationLevel: 'experimental'
    };
  }

  /**
   * Evaluates a caller-parameterized Black's equation estimate.
   *
   * Formula = (A / J^n) * exp( Ea / (kB * T) )
   *
   * @param {number} currentDensity - Current density J (A/cm^2)
   * @param {number} tempC - Caller-supplied temperature in Celsius
   * @param {Object} model - Caller-supplied coefficients and provenance
   * @param {number} model.preExponentialCoefficient - Coefficient with units consistent with J and hours
   * @param {number} model.activationEnergyEV - Activation energy (eV)
   * @param {number} model.currentDensityExponent - Current-density exponent
   * @param {number} model.boltzmannEVPerK - Boltzmann coefficient (eV/K)
   * @param {string} model.provenance - Source or explicit unverified-data description
   * @returns {Object} Unverified formula estimate; no reliability classification
   */
  evaluateBlacksEM(currentDensity, tempC, model) {
    requirePositive(currentDensity, 'currentDensity');
    requireFinite(tempC, 'tempC');
    if (tempC <= -273.15) throw new RangeError('tempC must be above absolute zero.');
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      throw new TypeError('Caller-supplied Black model coefficients and provenance are required.');
    }
    const { preExponentialCoefficient, activationEnergyEV, currentDensityExponent, boltzmannEVPerK, provenance } =
      model;
    requirePositive(preExponentialCoefficient, 'preExponentialCoefficient');
    requirePositive(activationEnergyEV, 'activationEnergyEV');
    requirePositive(currentDensityExponent, 'currentDensityExponent');
    requirePositive(boltzmannEVPerK, 'boltzmannEVPerK');
    if (typeof provenance !== 'string' || provenance.trim().length === 0) {
      throw new TypeError('Black model provenance must be a non-empty caller-supplied string.');
    }
    const T_celsius = tempC;
    const T_kelvin = T_celsius + 273.15;
    const formulaEstimateHours =
      (preExponentialCoefficient / Math.pow(currentDensity, currentDensityExponent)) *
      Math.exp(activationEnergyEV / (boltzmannEVPerK * T_kelvin));
    if (!Number.isFinite(formulaEstimateHours) || formulaEstimateHours <= 0) {
      throw new RangeError('Black formula result is outside the finite numeric range.');
    }
    const formulaEstimateYears = formulaEstimateHours / 8760;

    return {
      currentDensity,
      tempC: T_celsius,
      tempK: T_kelvin,
      formulaEstimateHours,
      formulaEstimateYears,
      // Legacy result names retained for callers; the estimate remains unverified.
      mttfHours: formulaEstimateHours,
      mttfYears: formulaEstimateYears,
      model: {
        preExponentialCoefficient,
        activationEnergyEV,
        currentDensityExponent,
        boltzmannEVPerK,
        provenance
      },
      dataStatus: 'caller-supplied-unverified',
      validationLevel: 'experimental'
    };
  }

  /**
   * Calculates independent lumped terms used in transient PDN estimates.
   * No transient voltage waveform or decoupling response is solved.
   *
   * @param {Object} params Caller-supplied lumped inputs
   * @param {number} params.peakCurrent Peak current (A)
   * @param {number} params.riseTime Current rise time (s)
   * @param {number} params.packageInductance Loop inductance (H)
   * @param {number} params.decapCapacitance Capacitance (F)
   * @param {number} params.rEffective Effective lumped resistance (ohm)
   * @returns {Object} Independent lumped terms; no transient waveform is solved
   */
  simulateDynamicDecapDroop(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new TypeError('Caller-supplied lumped PDN inputs are required.');
    }
    const { peakCurrent, riseTime, packageInductance, decapCapacitance, rEffective } = params;
    requirePositive(peakCurrent, 'peakCurrent');
    requirePositive(riseTime, 'riseTime');
    requireNonNegative(packageInductance, 'packageInductance');
    requirePositive(decapCapacitance, 'decapCapacitance');
    requireNonNegative(rEffective, 'rEffective');

    const dIdt = peakCurrent / riseTime;
    const inductiveBounce = packageInductance * dIdt; // L * di/dt
    const resistiveDrop = peakCurrent * rEffective;

    // The triangular-current charge assumption is an independent lumped estimate.
    const chargeDrawn = 0.5 * peakCurrent * riseTime;
    const decapVoltageChangeEstimate = chargeDrawn / decapCapacitance;
    const lumpedSupplyDropEstimate = resistiveDrop + inductiveBounce;

    return {
      peakCurrent,
      riseTime,
      dIdt,
      inductiveBounce,
      resistiveDrop,
      lumpedSupplyDropEstimate,
      decapCapacitance,
      chargeDrawn,
      decapVoltageChangeEstimate,
      modelDescription: 'independent lumped terms; triangular current charge estimate; no transient waveform solved',
      dataStatus: 'caller-supplied-unverified',
      validationLevel: 'experimental'
    };
  }

  /**
   * Internal Gauss-Jordan linear solver with partial pivoting for dense G matrix.
   */
  _solveLinearSystem(A, b, n) {
    const M = new Float64Array(n * (n + 1));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        M[i * (n + 1) + j] = A[i * n + j];
      }
      M[i * (n + 1) + n] = b[i];
    }

    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i;
      let maxVal = Math.abs(M[i * (n + 1) + i]);
      for (let k = i + 1; k < n; k++) {
        const val = Math.abs(M[k * (n + 1) + i]);
        if (val > maxVal) {
          maxVal = val;
          maxRow = k;
        }
      }

      if (maxRow !== i) {
        for (let j = 0; j <= n; j++) {
          const tmp = M[i * (n + 1) + j];
          M[i * (n + 1) + j] = M[maxRow * (n + 1) + j];
          M[maxRow * (n + 1) + j] = tmp;
        }
      }

      const pivot = M[i * (n + 1) + i];
      if (Math.abs(pivot) < 1e-14) continue;

      for (let j = i; j <= n; j++) {
        M[i * (n + 1) + j] /= pivot;
      }

      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = M[k * (n + 1) + i];
          for (let j = i; j <= n; j++) {
            M[k * (n + 1) + j] -= factor * M[i * (n + 1) + j];
          }
        }
      }
    }

    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = M[i * (n + 1) + n];
    }
    return x;
  }
}

// Isomorphic Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PowerGridIRDropAnalyzer };
}
if (typeof window !== 'undefined') {
  window.PowerGridIRDropAnalyzer = PowerGridIRDropAnalyzer;
}
