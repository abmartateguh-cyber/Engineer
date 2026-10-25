/**
 * OmniEng Dynamic Simulink Multi-Rate Scheduler & Modern Control Synthesis
 *
 * Provides:
 * 1. Hybrid Continuous/Discrete Multi-Rate Scheduler (deterministic multi-frequency execution with ZOH).
 * 2. Tarjan's Strongly Connected Components (SCC) algebraic loop detector.
 * 3. Broyden quasi-Newton non-linear algebraic loop solver with backtracking line search.
 * 4. Modern Control Synthesis: Continuous and Discrete LQR via Algebraic Riccati Equation (CARE/DARE).
 *
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class RateTransitionBuffer {
  /**
   * Zero-Order Hold (ZOH) buffer connecting tasks of different sample rates.
   * @param {string} sourceTask
   * @param {string} targetTask
   */
  constructor(sourceTask, targetTask) {
    this.sourceTask = sourceTask;
    this.targetTask = targetTask;
    this.currentValue = null;
    this.latchedValue = null;
    this.lastUpdateTime = 0.0;
  }

  write(val, time) {
    this.currentValue = val;
    this.lastUpdateTime = time;
  }

  read() {
    // Returns the held value (ZOH)
    return this.latchedValue !== null ? this.latchedValue : this.currentValue;
  }

  latch() {
    this.latchedValue = this.currentValue;
  }
}

class ScheduledTask {
  /**
   * @param {Object} config
   * @param {string} config.id
   * @param {string} config.name
   * @param {number} config.sampleRateHz - e.g., 1000, 100, 10
   * @param {number} [config.priority=1] - 1 (highest) to 10 (lowest)
   * @param {number} [config.phaseOffsetSec=0.0]
   * @param {Function} config.stepFn - (t, dt, inputs) => outputs
   */
  constructor(config) {
    this.id = config.id || 'task_' + Math.random().toString(36).substr(2, 6);
    this.name = config.name || this.id;
    this.sampleRateHz = config.sampleRateHz || 100;
    this.periodSec = 1.0 / this.sampleRateHz;
    this.priority = config.priority || 1;
    this.phaseOffsetSec = config.phaseOffsetSec || 0.0;
    this.stepFn = config.stepFn || ((t, dt, inputs) => inputs);

    this.executionCount = 0;
    this.lastExecutionTime = -1.0;
    this.state = {};
  }
}

class MultiRateScheduler {
  /**
   * @param {Object} options
   * @param {number} [options.baseRateHz=1000] - Base simulation clock frequency
   */
  constructor(options = {}) {
    this.baseRateHz = options.baseRateHz || 1000;
    this.baseDt = 1.0 / this.baseRateHz;
    this.tasks = new Map();
    this.rateBuffers = new Map();
    this.currentTime = 0.0;
    this.currentTick = 0;
    this.history = [];
  }

  /**
   * Registers a scheduled task.
   * @param {ScheduledTask|Object} taskConfig
   */
  addTask(taskConfig) {
    const task = taskConfig instanceof ScheduledTask ? taskConfig : new ScheduledTask(taskConfig);
    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * Connects two tasks via a Zero-Order Hold (ZOH) rate transition buffer.
   */
  connectTasks(sourceTaskId, targetTaskId) {
    const key = `${sourceTaskId}->${targetTaskId}`;
    const buffer = new RateTransitionBuffer(sourceTaskId, targetTaskId);
    this.rateBuffers.set(key, buffer);
    return buffer;
  }

  /**
   * Checks if a task should fire on the current integer tick.
   * @param {ScheduledTask} task
   * @param {number} tick
   */
  shouldTaskFire(task, tick) {
    const periodTicks = Math.round(task.periodSec * this.baseRateHz);
    const offsetTicks = Math.round(task.phaseOffsetSec * this.baseRateHz);
    if (periodTicks <= 0) return true;
    return tick - offsetTicks >= 0 && (tick - offsetTicks) % periodTicks === 0;
  }

  /**
   * Executes a single base-rate simulation step.
   * @returns {Object} Step execution summary
   */
  step() {
    const t = this.currentTime;
    const executedTasks = [];

    // Sort active tasks by priority (ascending: 1 = highest)
    const activeTasks = [];
    for (const [id, task] of this.tasks.entries()) {
      if (this.shouldTaskFire(task, this.currentTick)) {
        activeTasks.push(task);
      }
    }
    activeTasks.sort((a, b) => a.priority - b.priority);

    // Latch target buffers before running tasks
    for (const buffer of this.rateBuffers.values()) {
      buffer.latch();
    }

    // Execute each active task
    for (const task of activeTasks) {
      // Gather inputs from incoming rate transition buffers
      const inputs = {};
      for (const [key, buffer] of this.rateBuffers.entries()) {
        if (buffer.targetTask === task.id) {
          inputs[buffer.sourceTask] = buffer.read();
        }
      }

      const out = task.stepFn(t, task.periodSec, inputs, task.state);
      task.executionCount++;
      task.lastExecutionTime = t;

      // Update outgoing rate transition buffers
      for (const [key, buffer] of this.rateBuffers.entries()) {
        if (buffer.sourceTask === task.id) {
          buffer.write(out, t);
        }
      }

      executedTasks.push({ id: task.id, output: out });
    }

    const stepSummary = {
      tick: this.currentTick,
      time: t,
      executedTasksCount: executedTasks.length,
      executedTasks
    };

    this.currentTick++;
    this.currentTime = this.currentTick * this.baseDt;
    return stepSummary;
  }

  /**
   * Runs the multi-rate simulation for a specified duration.
   * @param {number} durationSec
   */
  run(durationSec) {
    const totalTicks = Math.round(durationSec * this.baseRateHz);
    const log = [];
    for (let i = 0; i < totalTicks; i++) {
      const summary = this.step();
      if (summary.executedTasksCount > 0) {
        log.push(summary);
      }
    }
    return {
      totalTicks,
      simulatedTime: this.currentTime,
      logCount: log.length,
      taskStats: Array.from(this.tasks.values()).map((t) => ({
        id: t.id,
        name: t.name,
        rateHz: t.sampleRateHz,
        executions: t.executionCount
      }))
    };
  }
}

class AlgebraicLoopSolver {
  /**
   * Detects graph cycles (algebraic loops) using Tarjan's Strongly Connected Components algorithm.
   * @param {Map<string, string[]>|Object} adjacencyList - node -> array of dependent nodes
   * @returns {string[][]} Array of strongly connected components with size > 1
   */
  static findAlgebraicLoops(adjacencyList) {
    let index = 0;
    const indices = new Map();
    const lowlinks = new Map();
    const onStack = new Map();
    const stack = [];
    const sccs = [];

    const nodes = adjacencyList instanceof Map ? Array.from(adjacencyList.keys()) : Object.keys(adjacencyList);

    function strongConnect(v) {
      indices.set(v, index);
      lowlinks.set(v, index);
      index++;
      stack.push(v);
      onStack.set(v, true);

      const neighbors = (adjacencyList instanceof Map ? adjacencyList.get(v) : adjacencyList[v]) || [];
      for (const w of neighbors) {
        if (!indices.has(w)) {
          strongConnect(w);
          lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
        } else if (onStack.get(w)) {
          lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
        }
      }

      if (lowlinks.get(v) === indices.get(v)) {
        const scc = [];
        let w;
        do {
          w = stack.pop();
          onStack.set(w, false);
          scc.push(w);
        } while (w !== v);

        if (scc.length > 1) {
          sccs.push(scc);
        }
      }
    }

    for (const node of nodes) {
      if (!indices.has(node)) {
        strongConnect(node);
      }
    }

    return sccs;
  }

  /**
   * Solves an algebraic loop R(x) = f(x) - x = 0 using Broyden's quasi-Newton method with line search.
   * @param {Function} f - Vector function f(x) -> x_out
   * @param {number[]} x0 - Initial guess vector
   * @param {Object} [options]
   * @param {number} [options.tol=1e-7]
   * @param {number} [options.maxIter=50]
   * @returns {{x: number[], iterations: number, residualNorm: number, converged: boolean}}
   */
  static solveBroyden(f, x0, options = {}) {
    const tol = options.tol || 1e-7;
    const maxIter = options.maxIter || 50;
    const n = x0.length;

    let x = [...x0];

    // Evaluate initial residual R(x) = f(x) - x
    const fx = f(x);
    let r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      r[i] = fx[i] - x[i];
    }

    let normR = Math.hypot(...r);
    if (normR < tol) {
      return { x, iterations: 0, residualNorm: normR, converged: true };
    }

    // Initialize approximate inverse Jacobian H0 = -I (since dR/dx ~ -I for weak feedback)
    // H approximates (dR/dx)^(-1)
    let H = [];
    for (let i = 0; i < n; i++) {
      H[i] = new Float64Array(n);
      H[i][i] = -1.0;
    }

    let iterations = 0;
    while (iterations < maxIter && normR > tol) {
      iterations++;

      // Compute step: p = -H * r
      const p = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += H[i][j] * r[j];
        }
        p[i] = -sum;
      }

      // Backtracking line search
      let alpha = 1.0;
      let xNew = new Float64Array(n);
      let rNew = new Float64Array(n);
      let normRNew = Infinity;

      for (let ls = 0; ls < 8; ls++) {
        for (let i = 0; i < n; i++) {
          xNew[i] = x[i] + alpha * p[i];
        }
        const fxNew = f(Array.from(xNew));
        for (let i = 0; i < n; i++) {
          rNew[i] = fxNew[i] - xNew[i];
        }
        normRNew = Math.hypot(...rNew);
        if (normRNew < normR) break;
        alpha *= 0.5;
      }

      // Step change s = xNew - x
      const s = new Float64Array(n);
      // Residual change y = rNew - r
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        s[i] = xNew[i] - x[i];
        y[i] = rNew[i] - r[i];
      }

      // Update inverse Jacobian using Sherman-Morrison Broyden formula:
      // H_new = H + (s - H*y) * (s^T * H) / (s^T * H * y)
      const Hy = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += H[i][j] * y[j];
        }
        Hy[i] = sum;
      }

      const sTH = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
          sum += s[i] * H[i][j];
        }
        sTH[j] = sum;
      }

      let denom = 0;
      for (let i = 0; i < n; i++) {
        denom += sTH[i] * y[i];
      }

      if (Math.abs(denom) > 1e-12) {
        for (let i = 0; i < n; i++) {
          const diff = s[i] - Hy[i];
          for (let j = 0; j < n; j++) {
            H[i][j] += (diff * sTH[j]) / denom;
          }
        }
      }

      x = Array.from(xNew);
      r = rNew;
      normR = normRNew;
    }

    return {
      x,
      iterations,
      residualNorm: normR,
      converged: normR <= tol
    };
  }
}

class ModernControlSynthesis {
  /**
   * Solves Continuous-time Linear Quadratic Regulator (CARE):
   * A^T * P + P * A - P * B * R^(-1) * B^T * P + Q = 0
   * Gain K = R^(-1) * B^T * P
   *
   * Uses iterative Kleinman Newton-Raphson method.
   * @param {number[][]} A - n x n system matrix
   * @param {number[][]} B - n x m input matrix
   * @param {number[][]} Q - n x n state weight (semi-definite)
   * @param {number[][]} R - m x m control weight (positive-definite)
   * @returns {{P: number[][], K: number[][], closedLoopA: number[][]}}
   */
  static solveContinuousLQR(A, B, Q, R, maxIter, tol) {
    if (!Number.isInteger(maxIter) || maxIter < 1 || maxIter > 10000 || !Number.isFinite(tol) || tol <= 0) {
      throw new TypeError('solveContinuousLQR requires positive iteration and tolerance inputs.');
    }
    const n = A.length;
    const m = B[0].length;
    const Rinv = this._invertMatrix(R);

    // Initial stabilizing gain K0
    let K = [];
    for (let i = 0; i < m; i++) {
      K[i] = [];
      for (let j = 0; j < n; j++) {
        K[i][j] = 1.0;
      }
    }

    let P = Q.map((row) => [...row]);

    for (let iter = 0; iter < maxIter; iter++) {
      // Closed-loop Ac = A - B*K
      const BK = this._multiply(B, K);
      const Ac = [];
      for (let i = 0; i < n; i++) {
        Ac[i] = [];
        for (let j = 0; j < n; j++) {
          Ac[i][j] = A[i][j] - BK[i][j];
        }
      }

      // Effective state cost: Qc = Q + K^T * R * K
      const KT = this._transpose(K);
      const KTR = this._multiply(KT, R);
      const KTRK = this._multiply(KTR, K);
      const Qc = [];
      for (let i = 0; i < n; i++) {
        Qc[i] = [];
        for (let j = 0; j < n; j++) {
          Qc[i][j] = Q[i][j] + KTRK[i][j];
        }
      }

      // Solve Continuous Lyapunov: Ac^T * P_next + P_next * Ac = -Qc
      const P_next = this._solveContinuousLyapunov(Ac, Qc);

      // Compute updated gain: K_next = Rinv * B^T * P_next
      const BT = this._transpose(B);
      const BTP = this._multiply(BT, P_next);
      const K_next = this._multiply(Rinv, BTP);

      // Check convergence
      let diff = 0;
      for (let i = 0; i < m; i++) {
        for (let j = 0; j < n; j++) {
          diff += Math.abs(K_next[i][j] - K[i][j]);
        }
      }

      P = P_next;
      K = K_next;
      if (diff < tol) break;
    }

    const BK = this._multiply(B, K);
    const closedLoopA = [];
    for (let i = 0; i < n; i++) {
      closedLoopA[i] = [];
      for (let j = 0; j < n; j++) {
        closedLoopA[i][j] = A[i][j] - BK[i][j];
      }
    }

    return { P, K, closedLoopA };
  }

  /**
   * Solves Discrete-time Linear Quadratic Regulator (DARE):
   * P = A^T * P * A - (A^T * P * B) * (R + B^T * P * B)^(-1) * (B^T * P * A) + Q
   * Gain K = (R + B^T * P * B)^(-1) * B^T * P * A
   *
   * @param {number[][]} A
   * @param {number[][]} B
   * @param {number[][]} Q
   * @param {number[][]} R
   */
  static solveDiscreteLQR(A, B, Q, R, maxIter = 80, tol = 1e-9) {
    const n = A.length;
    let P = Q.map((row) => [...row]);

    for (let iter = 0; iter < maxIter; iter++) {
      const AT = this._transpose(A);
      const BT = this._transpose(B);

      // ATP = A^T * P
      const ATP = this._multiply(AT, P);
      // ATPA = A^T * P * A
      const ATPA = this._multiply(ATP, A);

      // BTP = B^T * P
      const BTP = this._multiply(BT, P);
      // BTPB = B^T * P * B
      const BTPB = this._multiply(BTP, B);

      // M = R + B^T * P * B
      const M = [];
      for (let i = 0; i < R.length; i++) {
        M[i] = [];
        for (let j = 0; j < R[0].length; j++) {
          M[i][j] = R[i][j] + BTPB[i][j];
        }
      }
      const Minv = this._invertMatrix(M);

      // ATPB = A^T * P * B
      const ATPB = this._multiply(ATP, B);
      // BTPA = B^T * P * A
      const BTPA = this._multiply(BTP, A);

      // Term = ATPB * Minv * BTPA
      const term1 = this._multiply(ATPB, Minv);
      const term2 = this._multiply(term1, BTPA);

      // P_next = ATPA - term2 + Q
      const P_next = [];
      let diff = 0;
      for (let i = 0; i < n; i++) {
        P_next[i] = [];
        for (let j = 0; j < n; j++) {
          P_next[i][j] = ATPA[i][j] - term2[i][j] + Q[i][j];
          diff += Math.abs(P_next[i][j] - P[i][j]);
        }
      }

      P = P_next;
      if (diff < tol) break;
    }

    const BT = this._transpose(B);
    const BTP = this._multiply(BT, P);
    const BTPB = this._multiply(BTP, B);
    const M = [];
    for (let i = 0; i < R.length; i++) {
      M[i] = [];
      for (let j = 0; j < R[0].length; j++) {
        M[i][j] = R[i][j] + BTPB[i][j];
      }
    }
    const Minv = this._invertMatrix(M);
    const BTPA = this._multiply(BTP, A);
    const K = this._multiply(Minv, BTPA);

    return { P, K };
  }

  // --- Internal Matrix Utilities ---

  static _transpose(M) {
    const rows = M.length;
    const cols = M[0].length;
    const T = [];
    for (let j = 0; j < cols; j++) {
      T[j] = [];
      for (let i = 0; i < rows; i++) {
        T[j][i] = M[i][j];
      }
    }
    return T;
  }

  static _multiply(A, B) {
    const rA = A.length;
    const cA = A[0].length;
    const cB = B[0].length;
    const out = [];
    for (let i = 0; i < rA; i++) {
      out[i] = new Float64Array(cB);
      for (let j = 0; j < cB; j++) {
        let sum = 0;
        for (let k = 0; k < cA; k++) {
          sum += A[i][k] * B[k][j];
        }
        out[i][j] = sum;
      }
    }
    return out.map((r) => Array.from(r));
  }

  static _invertMatrix(M) {
    const n = M.length;
    if (n === 1) {
      return [[1.0 / M[0][0]]];
    }
    if (n === 2) {
      const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
      if (Math.abs(det) < 1e-12) throw new Error('Singular matrix in inversion');
      return [
        [M[1][1] / det, -M[0][1] / det],
        [-M[1][0] / det, M[0][0] / det]
      ];
    }
    // General Gauss-Jordan elimination
    const A = M.map((row, i) => {
      const ext = new Float64Array(2 * n);
      for (let j = 0; j < n; j++) ext[j] = row[j];
      ext[n + i] = 1.0;
      return ext;
    });

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
      }
      const tmp = A[i];
      A[i] = A[maxRow];
      A[maxRow] = tmp;
      const pivot = A[i][i];
      if (Math.abs(pivot) < 1e-12) throw new Error('Matrix is singular');
      for (let j = 0; j < 2 * n; j++) A[i][j] /= pivot;
      for (let k = 0; k < n; k++) {
        if (k !== i) {
          const factor = A[k][i];
          for (let j = 0; j < 2 * n; j++) A[k][j] -= factor * A[i][j];
        }
      }
    }

    const inv = [];
    for (let i = 0; i < n; i++) {
      inv[i] = [];
      for (let j = 0; j < n; j++) {
        inv[i][j] = A[i][n + j];
      }
    }
    return inv;
  }

  static _solveContinuousLyapunov(A, Q) {
    // Solves A^T * P + P * A = -Q via Kronecker product vectorization:
    // (I (x) A^T + A^T (x) I) * vec(P) = -vec(Q)
    const n = A.length;
    const n2 = n * n;
    const Mat = [];
    const rhs = new Float64Array(n2);

    for (let i = 0; i < n2; i++) {
      Mat[i] = new Float64Array(n2);
    }

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const rowIdx = r * n + c;
        rhs[rowIdx] = -Q[r][c];

        // A^T * P term
        for (let k = 0; k < n; k++) {
          const colIdx = k * n + c;
          Mat[rowIdx][colIdx] += A[k][r]; // A^T[r][k] = A[k][r]
        }
        // P * A term
        for (let k = 0; k < n; k++) {
          const colIdx = r * n + k;
          Mat[rowIdx][colIdx] += A[k][c]; // A[k][c]
        }
      }
    }

    // Solve Mat * vecP = rhs via Gaussian elimination
    for (let i = 0; i < n2; i++) {
      let maxR = i;
      for (let k = i + 1; k < n2; k++) {
        if (Math.abs(Mat[k][i]) > Math.abs(Mat[maxR][i])) maxR = k;
      }
      const tmpM = Mat[i];
      Mat[i] = Mat[maxR];
      Mat[maxR] = tmpM;
      const tmpR = rhs[i];
      rhs[i] = rhs[maxR];
      rhs[maxR] = tmpR;

      const pivot = Mat[i][i];
      if (Math.abs(pivot) > 1e-12) {
        for (let j = i; j < n2; j++) Mat[i][j] /= pivot;
        rhs[i] /= pivot;
        for (let k = 0; k < n2; k++) {
          if (k !== i) {
            const f = Mat[k][i];
            for (let j = i; j < n2; j++) Mat[k][j] -= f * Mat[i][j];
            rhs[k] -= f * rhs[i];
          }
        }
      }
    }

    const P = [];
    for (let r = 0; r < n; r++) {
      P[r] = [];
      for (let c = 0; c < n; c++) {
        P[r][c] = rhs[r * n + c];
      }
    }
    return P;
  }
}

const { GoldfarbIdnaniQPSolver, ModelPredictiveController } = require('./model_predictive_control');

module.exports = {
  RateTransitionBuffer,
  ScheduledTask,
  MultiRateScheduler,
  AlgebraicLoopSolver,
  ModernControlSynthesis,
  GoldfarbIdnaniQPSolver,
  ModelPredictiveController
};
