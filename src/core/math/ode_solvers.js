/**
 * Experimental numerical ODE / DAE solvers.
 * Implements explicit and stiff differential equation integration methods.
 */

class ODESolvers {
  /**
   * Runge-Kutta 4th Order (RK4) for state derivative vector dy/dt = f(t, y)
   */
  static solveRK4(f, arg2, arg3, arg4, arg5) {
    let t0, y0, dt, steps;
    if (Array.isArray(arg2)) {
      y0 = arg2;
      t0 = arg3;
      const tEnd = arg4;
      dt = arg5 || 0.01;
      steps = Math.round((tEnd - t0) / dt);
    } else {
      t0 = arg2;
      y0 = arg3;
      dt = arg4;
      steps = arg5;
    }

    const trajectory = [{ t: t0, y: [...y0] }];
    let t = t0;
    let y = [...y0];
    const n = y0.length;

    for (let step = 0; step < steps; step++) {
      const k1 = f(t, y);
      
      const y_k2 = new Array(n);
      for (let i = 0; i < n; i++) y_k2[i] = y[i] + 0.5 * dt * k1[i];
      const k2 = f(t + 0.5 * dt, y_k2);

      const y_k3 = new Array(n);
      for (let i = 0; i < n; i++) y_k3[i] = y[i] + 0.5 * dt * k2[i];
      const k3 = f(t + 0.5 * dt, y_k3);

      const y_k4 = new Array(n);
      for (let i = 0; i < n; i++) y_k4[i] = y[i] + dt * k3[i];
      const k4 = f(t + dt, y_k4);

      for (let i = 0; i < n; i++) {
        y[i] += (dt / 6.0) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      }
      t = +(t + dt).toFixed(8);
      trajectory.push({ t, y: [...y] });
    }

    return trajectory;
  }

  static rk4(f, t0, y0, dt, steps) {
    return ODESolvers.solveRK4(f, t0, y0, dt, steps);
  }

  /**
   * Adaptive Dormand-Prince RK45 integration.
   */
  static solveRK45(f, arg2, arg3, arg4, arg5 = 1e-6, arg6 = 0.01) {
    let t0, y0, tEnd, tol, hInitial;
    if (Array.isArray(arg2)) {
      y0 = arg2;
      t0 = arg3;
      tEnd = arg4;
      tol = typeof arg5 === 'number' ? arg5 : 1e-6;
      hInitial = typeof arg6 === 'number' ? arg6 : 0.01;
    } else {
      t0 = arg2;
      y0 = arg3;
      tEnd = arg4;
      tol = arg5;
      hInitial = arg6;
    }

    const trajectory = [{ t: t0, y: [...y0] }];
    let t = t0;
    let y = [...y0];
    let h = hInitial;
    const n = y0.length;

    // Butcher tableau coefficients for Dormand-Prince
    const c2 = 1 / 5, a21 = 1 / 5;
    const c3 = 3 / 10, a31 = 3 / 40, a32 = 9 / 40;
    const c4 = 4 / 5, a41 = 44 / 45, a42 = -56 / 15, a43 = 32 / 9;
    const c5 = 8 / 9, a51 = 19372 / 6561, a52 = -25360 / 2187, a53 = 64448 / 6561, a54 = -212 / 729;
    const a61 = 9017 / 3168, a62 = -355 / 33, a63 = 46732 / 5247, a64 = 49 / 176, a65 = -5103 / 18656;
    const a71 = 35 / 384, a73 = 500 / 1113, a74 = 125 / 192, a75 = -2187 / 6784, a76 = 11 / 84;

    // 4th order comparison weights
    const b1 = 5179 / 57600, b3 = 7571 / 16695, b4 = 393 / 640, b5 = -92097 / 339200, b6 = 187 / 2100, b7 = 1 / 40;

    let iterations = 0;
    const maxIterations = 50000;

    while (t < tEnd && iterations < maxIterations) {
      iterations++;
      if (t + h > tEnd) h = tEnd - t;

      const k1 = f(t, y);
      
      const y2 = y.map((val, i) => val + h * a21 * k1[i]);
      const k2 = f(t + c2 * h, y2);

      const y3 = y.map((val, i) => val + h * (a31 * k1[i] + a32 * k2[i]));
      const k3 = f(t + c3 * h, y3);

      const y4 = y.map((val, i) => val + h * (a41 * k1[i] + a42 * k2[i] + a43 * k3[i]));
      const k4 = f(t + c4 * h, y4);

      const y5 = y.map((val, i) => val + h * (a51 * k1[i] + a52 * k2[i] + a53 * k3[i] + a54 * k4[i]));
      const k5 = f(t + c5 * h, y5);

      const y6 = y.map((val, i) => val + h * (a61 * k1[i] + a62 * k2[i] + a63 * k3[i] + a64 * k4[i] + a65 * k5[i]));
      const k6 = f(t + h, y6);

      // 5th order solution
      const y_next = y.map((val, i) => val + h * (a71 * k1[i] + a73 * k3[i] + a74 * k4[i] + a75 * k5[i] + a76 * k6[i]));
      const k7 = f(t + h, y_next);

      // Error estimate between 5th and 4th order
      let maxError = 0;
      for (let i = 0; i < n; i++) {
        const y4_val = y[i] + h * (b1 * k1[i] + b3 * k3[i] + b4 * k4[i] + b5 * k5[i] + b6 * k6[i] + b7 * k7[i]);
        const err = Math.abs(y_next[i] - y4_val);
        const scale = tol * (1 + Math.max(Math.abs(y[i]), Math.abs(y_next[i])));
        maxError = Math.max(maxError, err / scale);
      }

      if (maxError <= 1.0 || h <= 1e-12) {
        // Accept step
        t += h;
        y = y_next;
        trajectory.push({ t, y: [...y] });
      }

      // Compute optimal next step size
      const factor = maxError === 0 ? 2.0 : Math.min(2.0, Math.max(0.1, 0.9 * Math.pow(1.0 / maxError, 0.2)));
      h *= factor;
      if (h < 1e-12) h = 1e-12;
      if (h > (tEnd - t0) / 10) h = (tEnd - t0) / 10;
    }

    return trajectory;
  }

  /**
   * Stiff ODE Backward Euler / BDF1 Integrator with Newton-Raphson
   */
  static bdf1Stiff(f, jacobian, t0, y0, dt, steps) {
    const trajectory = [{ t: t0, y: [...y0] }];
    let t = t0;
    let y = [...y0];
    const n = y0.length;

    for (let s = 0; s < steps; s++) {
      const tNext = t + dt;
      // Solve: g(yNext) = yNext - y - dt * f(tNext, yNext) = 0
      let yNext = [...y]; // initial guess

      for (let iter = 0; iter < 20; iter++) {
        const fy = f(tNext, yNext);
        const residual = yNext.map((yn, i) => yn - y[i] - dt * fy[i]);

        let resNorm = 0;
        for (let i = 0; i < n; i++) resNorm += residual[i] * residual[i];
        if (Math.sqrt(resNorm) < 1e-9) break;

        // Jacobian of g: J_g = I - dt * J_f
        const Jf = jacobian(tNext, yNext);
        const Jg = [];
        for (let r = 0; r < n; r++) {
          Jg[r] = [];
          for (let c = 0; c < n; c++) {
            const identity = r === c ? 1 : 0;
            Jg[r][c] = identity - dt * Jf[r][c];
          }
        }

        // Solve Jg * dy = -residual
        // Using simple Gaussian solve
        const minusRes = residual.map(r => -r);
        const { LinearSolver } = require('./linear_algebra');
        const dy = LinearSolver.solveGaussian(Jg, minusRes);

        for (let i = 0; i < n; i++) {
          yNext[i] += dy[i];
        }
      }

      t = tNext;
      y = yNext;
      trajectory.push({ t, y: [...y] });
    }

    return trajectory;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ODESolvers };
}
