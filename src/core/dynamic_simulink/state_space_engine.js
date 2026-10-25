/**
 * OmniEng State-Space & Non-Linear Dynamic Blocks Engine
 * Standard: Continuous/Discrete State-Space and Canonical Transfer Function Forms
 * Experimental implementation: MATLAB / Simulink Continuous & Non-Linear Block Library.
 */

class StateSpaceEngine {
  /**
   * Continuous State-Space System:
   * dx/dt = A*x + B*u
   * y = C*x + D*u
   */
  constructor(A, B, C, D, initialX = null) {
    this.A = A; // n x n
    this.B = B; // n x m
    this.C = C; // p x n
    this.D = D; // p x m

    this.n = A.length;
    this.m = B[0].length || 1;
    this.p = C.length;

    this.x = initialX ? new Float64Array(initialX) : new Float64Array(this.n);
    this.t = 0.0;
  }

  /**
   * Advances the continuous state-space system by dt using 4th-order Runge-Kutta (RK4).
   * @param {number[]} u Input vector of length m
   * @param {number} dt Time step
   */
  stepRK4(u, dt) {
    const n = this.n;
    const x = this.x;

    const calcDeriv = (currX) => {
      const dxdt = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += this.A[i][j] * currX[j];
        }
        for (let k = 0; k < this.m; k++) {
          sum += this.B[i][k] * u[k];
        }
        dxdt[i] = sum;
      }
      return dxdt;
    };

    // k1 = f(x, u)
    const k1 = calcDeriv(x);

    // k2 = f(x + 0.5*dt*k1, u)
    const x2 = new Float64Array(n);
    for (let i = 0; i < n; i++) x2[i] = x[i] + 0.5 * dt * k1[i];
    const k2 = calcDeriv(x2);

    // k3 = f(x + 0.5*dt*k2, u)
    const x3 = new Float64Array(n);
    for (let i = 0; i < n; i++) x3[i] = x[i] + 0.5 * dt * k2[i];
    const k3 = calcDeriv(x3);

    // k4 = f(x + dt*k3, u)
    const x4 = new Float64Array(n);
    for (let i = 0; i < n; i++) x4[i] = x[i] + dt * k3[i];
    const k4 = calcDeriv(x4);

    // Update state x = x + (dt/6)*(k1 + 2k2 + 2k3 + k4)
    for (let i = 0; i < n; i++) {
      x[i] += (dt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    }
    this.t += dt;

    // Output y = C*x + D*u
    const y = new Float64Array(this.p);
    for (let i = 0; i < this.p; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += this.C[i][j] * x[j];
      }
      for (let k = 0; k < this.m; k++) {
        sum += this.D[i][k] * u[k];
      }
      y[i] = sum;
    }

    return Array.from(y);
  }

  /**
   * Simulates continuous response over time interval [0, tStop].
   * @param {function|number[]} uInput Input vector or function u(t)
   * @param {number[]} initialX Initial state vector
   * @param {number} tStop Total duration (s)
   * @param {number} dt Time step (s)
   */
  simulateContinuous(uInput = [1.0], initialX = null, tStop = 5.0, dt = 0.01) {
    if (initialX) {
      this.x = new Float64Array(initialX);
    }
    this.t = 0.0;
    const time = [];
    const states = [];
    const outputs = [];

    const steps = Math.ceil(tStop / dt);
    for (let step = 0; step <= steps; step++) {
      const t = step * dt;
      const u = typeof uInput === 'function' ? uInput(t) : uInput;
      const uVec = Array.isArray(u) ? u : [u];
      
      time.push(Number(t.toFixed(4)));
      states.push(Array.from(this.x));
      const y = this.stepRK4(uVec, dt);
      outputs.push(y);
    }

    return {
      time,
      x: states,
      y: outputs
    };
  }

  /**
   * Converts a SISO Transfer Function H(s) = num(s) / den(s)
   * into controllable canonical state-space form.
   * e.g. num = [b1, b0], den = [1, a1, a0] for 2nd order.
   */
  static fromTransferFunction(num, den) {
    // Normalize denominator so leading coefficient is 1
    const aLead = den[0];
    const normDen = den.map(v => v / aLead);
    const normNum = num.map(v => v / aLead);

    const n = normDen.length - 1; // Order of denominator
    // Pad numerator with leading zeros to match order
    while (normNum.length <= n) {
      normNum.unshift(0);
    }

    const D0 = normNum[0];
    const beta = [];
    for (let i = 1; i <= n; i++) {
      beta.push(normNum[i] - D0 * normDen[i]);
    }

    // Build A matrix (n x n)
    const A = [];
    for (let i = 0; i < n; i++) {
      A.push(new Float64Array(n));
    }
    for (let i = 0; i < n - 1; i++) {
      A[i][i + 1] = 1.0;
    }
    for (let j = 0; j < n; j++) {
      A[n - 1][j] = -normDen[n - j];
    }

    // Build B matrix (n x 1)
    const B = [];
    for (let i = 0; i < n; i++) {
      B.push([i === n - 1 ? 1.0 : 0.0]);
    }

    // Build C matrix (1 x n)
    const C = [[]];
    for (let j = 0; j < n; j++) {
      C[0].push(beta[n - 1 - j]);
    }

    // Build D matrix (1 x 1)
    const D = [[D0]];

    return new StateSpaceEngine(A, B, C, D);
  }

  /**
   * Non-Linear Saturation Block.
   */
  static saturation(u, lowerLimit = -1.0, upperLimit = 1.0) {
    return Math.max(lowerLimit, Math.min(upperLimit, u));
  }

  /**
   * Non-Linear Dead Zone Block.
   */
  static deadZone(u, startZone = -0.1, endZone = 0.1) {
    if (u > endZone) return u - endZone;
    if (u < startZone) return u - startZone;
    return 0.0;
  }

  /**
   * Rate Limiter Block.
   */
  static rateLimiter(u, uPrev, dt, risingSlewRate = 10.0, fallingSlewRate = -10.0) {
    if (dt <= 0) return u;
    const rate = (u - uPrev) / dt;
    if (rate > risingSlewRate) {
      return uPrev + risingSlewRate * dt;
    }
    if (rate < fallingSlewRate) {
      return uPrev + fallingSlewRate * dt;
    }
    return u;
  }

  /**
   * 1D Lookup Table with linear interpolation.
   */
  static lookupTable1D(x, tableX, tableY) {
    if (x <= tableX[0]) return tableY[0];
    if (x >= tableX[tableX.length - 1]) return tableY[tableY.length - 1];

    for (let i = 0; i < tableX.length - 1; i++) {
      if (x >= tableX[i] && x <= tableX[i + 1]) {
        const frac = (x - tableX[i]) / (tableX[i + 1] - tableX[i]);
        return tableY[i] + frac * (tableY[i + 1] - tableY[i]);
      }
    }
    return tableY[0];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StateSpaceEngine };
}
