/**
 * Experimental Navier-Stokes computational fluid dynamics (CFD) routines.
 * No independent validation against production CFD solvers is established.
 */

class CFDSolver2D {
  constructor(nx = 40, ny = 30, lx = 2.0, ly = 1.5, rho = 1.225, mu = 1.81e-5, bc = null) {
    this.nx = nx;
    this.ny = ny;
    this.lx = lx; // meters
    this.ly = ly;
    this.dx = lx / (nx - 1);
    this.dy = ly / (ny - 1);
    this.rho = rho; // kg/m^3 (air)
    this.mu = mu; // dynamic viscosity Pa*s
    this.nu = mu / rho; // kinematic viscosity
    // Boundary-condition configuration. Default (empty) is the legacy uniform
    // inlet/outlet channel: left inlet (u = inletVelocity), right outlet
    // (zero-gradient), slip top/bottom walls. Pass
    //   { top: { type: 'movingLid', u: lidSpeed } }
    // for a lid-driven-cavity configuration: no-slip on bottom/left/right,
    // tangential wall velocity u = lidSpeed on the top boundary.
    this.bc = bc && typeof bc === 'object' ? bc : {};

    // Grid fields: u (x-velocity), v (y-velocity), p (pressure)
    this.u = Array.from({ length: ny }, () => new Float64Array(nx));
    this.v = Array.from({ length: ny }, () => new Float64Array(nx));
    this.p = Array.from({ length: ny }, () => new Float64Array(nx));

    // Obstacle mask (true if solid body like drone arm or airfoil)
    this.obstacle = Array.from({ length: ny }, () => new Uint8Array(nx));
  }

  setAirfoilObstacle(chordRatio = 0.4, thicknessRatio = 0.12, angleOfAttackDeg = 4.0) {
    const aoaRad = (angleOfAttackDeg * Math.PI) / 180;
    const cx = Math.floor(this.nx * 0.35);
    const cy = Math.floor(this.ny * 0.5);
    const chordLen = Math.floor(this.nx * chordRatio);

    for (let i = 0; i < this.nx; i++) {
      for (let j = 0; j < this.ny; j++) {
        const rx = i - cx;
        const ry = j - cy;
        // Rotate by AoA
        const xRot = rx * Math.cos(-aoaRad) - ry * Math.sin(-aoaRad);
        const yRot = rx * Math.sin(-aoaRad) + ry * Math.cos(-aoaRad);

        if (xRot >= 0 && xRot <= chordLen) {
          const xNorm = xRot / chordLen;
          // NACA 0012 symmetric airfoil thickness formula
          const yt =
            5 *
            thicknessRatio *
            (0.2969 * Math.sqrt(xNorm) -
              0.126 * xNorm -
              0.3516 * Math.pow(xNorm, 2) +
              0.2843 * Math.pow(xNorm, 3) -
              0.1015 * Math.pow(xNorm, 4)) *
            chordLen;

          if (Math.abs(yRot) <= yt) {
            this.obstacle[j][i] = 1;
            this.u[j][i] = 0;
            this.v[j][i] = 0;
          }
        }
      }
    }
  }

  /**
   * Run steady-state flow simulation with uniform inlet velocity
   */
  solve(inletVelocity = 15.0, maxSteps = 150) {
    const dt = 0.001;
    const { nx, ny, dx, dy, rho, nu } = this;

    const topBc = this.bc.top || {};
    const movingLid = topBc.type === 'movingLid';
    const lidU = movingLid && Number.isFinite(topBc.u) ? topBc.u : inletVelocity;

    // Initialize velocity field. The lid-driven cavity starts from rest and
    // is driven only by the moving lid; the legacy channel starts from the
    // uniform inlet velocity.
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!this.obstacle[j][i]) {
          this.u[j][i] = movingLid ? 0 : inletVelocity;
          this.v[j][i] = 0;
        }
      }
    }

    // Pseudo-transient iteration loop
    for (let step = 0; step < maxSteps; step++) {
      const u_old = this.u.map((row) => new Float64Array(row));
      const v_old = this.v.map((row) => new Float64Array(row));

      // 1. Momentum Advection-Diffusion Step
      for (let j = 1; j < ny - 1; j++) {
        for (let i = 1; i < nx - 1; i++) {
          if (this.obstacle[j][i]) continue;

          const u_ij = u_old[j][i];
          const v_ij = v_old[j][i];

          // Upwind advection
          const du_dx = u_ij > 0 ? (u_ij - u_old[j][i - 1]) / dx : (u_old[j][i + 1] - u_ij) / dx;
          const du_dy = v_ij > 0 ? (u_ij - u_old[j - 1][i]) / dy : (u_old[j + 1][i] - u_ij) / dy;
          const dv_dx = u_ij > 0 ? (v_ij - v_old[j][i - 1]) / dx : (v_old[j][i + 1] - v_ij) / dx;
          const dv_dy = v_ij > 0 ? (v_ij - v_old[j - 1][i]) / dy : (v_old[j + 1][i] - v_ij) / dy;

          // Central diffusion
          const d2u =
            nu *
            ((u_old[j][i + 1] - 2 * u_ij + u_old[j][i - 1]) / (dx * dx) +
              (u_old[j + 1][i] - 2 * u_ij + u_old[j - 1][i]) / (dy * dy));
          const d2v =
            nu *
            ((v_old[j][i + 1] - 2 * v_ij + v_old[j][i - 1]) / (dx * dx) +
              (v_old[j + 1][i] - 2 * v_ij + v_old[j - 1][i]) / (dy * dy));

          this.u[j][i] = u_ij + dt * (-u_ij * du_dx - v_ij * du_dy + d2u);
          this.v[j][i] = v_ij + dt * (-u_ij * dv_dx - v_ij * dv_dy + d2v);
        }
      }

      // 2.+3. Projection loop: enforce continuity div(u) = 0 by solving the
      // pressure Poisson equation and correcting the velocity with the
      // pressure gradient. The moving-lid (enclosed cavity) configuration
      // repeats the projection several times per step: a single pass of the
      // scalar Jacobi sweep leaves enough divergence to suppress the cavity
      // recirculation, so the projection is interleaved (same stencils, same
      // correction) until the enclosed flow is close to solenoidal.
      const projectionCycles = movingLid ? 4 : 1;
      const pressureSweeps = movingLid ? 20 : 15;

      for (let cycle = 0; cycle < projectionCycles; cycle++) {
        for (let pIter = 0; pIter < pressureSweeps; pIter++) {
          for (let j = 1; j < ny - 1; j++) {
            for (let i = 1; i < nx - 1; i++) {
              if (this.obstacle[j][i]) continue;

              const div =
                (this.u[j][i + 1] - this.u[j][i - 1]) / (2 * dx) + (this.v[j + 1][i] - this.v[j - 1][i]) / (2 * dy);

              const p_new =
                ((this.p[j][i + 1] + this.p[j][i - 1]) / (dx * dx) +
                  (this.p[j + 1][i] + this.p[j - 1][i]) / (dy * dy) -
                  (rho / dt) * div) /
                (2 / (dx * dx) + 2 / (dy * dy));

              this.p[j][i] = p_new;
            }
          }

          // Pressure boundary conditions
          if (movingLid) {
            // Enclosed cavity: homogeneous Neumann (dp/dn = 0) on all walls.
            for (let j = 0; j < ny; j++) {
              this.p[j][0] = this.p[j][1];
              this.p[j][nx - 1] = this.p[j][nx - 2];
            }
            for (let i = 0; i < nx; i++) {
              this.p[0][i] = this.p[1][i];
              this.p[ny - 1][i] = this.p[ny - 2][i];
            }
          } else {
            for (let j = 0; j < ny; j++) {
              this.p[j][0] = this.p[j][1]; // dp/dx = 0 at inlet
              this.p[j][nx - 1] = 0; // p = 0 at outlet
            }
          }
        }

        if (movingLid) {
          // Homogeneous Neumann pressure boundary conditions leave the
          // pressure level free; pin its mean each projection to keep the
          // enclosed-cavity pressure bounded. Only gradients affect the
          // velocity correction, so this does not change the flow.
          let pSum = 0;
          for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) pSum += this.p[j][i];
          }
          const pMean = pSum / (nx * ny);
          for (let j = 0; j < ny; j++) {
            for (let i = 0; i < nx; i++) this.p[j][i] -= pMean;
          }
        }

        // Velocity Correction via Pressure Gradient
        for (let j = 1; j < ny - 1; j++) {
          for (let i = 1; i < nx - 1; i++) {
            if (this.obstacle[j][i]) {
              this.u[j][i] = 0;
              this.v[j][i] = 0;
              continue;
            }

            const dp_dx = (this.p[j][i + 1] - this.p[j][i - 1]) / (2 * dx);
            const dp_dy = (this.p[j + 1][i] - this.p[j - 1][i]) / (2 * dy);

            this.u[j][i] -= (dt / rho) * dp_dx;
            this.v[j][i] -= (dt / rho) * dp_dy;
          }
        }
      }

      // Inlet / Outlet / Wall Boundary conditions
      if (movingLid) {
        // Lid-driven cavity: no-slip on bottom/left/right walls, tangential
        // wall velocity u = lidU on the top boundary (moving lid).
        for (let j = 0; j < ny; j++) {
          this.u[j][0] = 0;
          this.v[j][0] = 0;
          this.u[j][nx - 1] = 0;
          this.v[j][nx - 1] = 0;
        }
        for (let i = 0; i < nx; i++) {
          this.u[0][i] = 0;
          this.v[0][i] = 0;
          this.u[ny - 1][i] = lidU;
          this.v[ny - 1][i] = 0;
        }
      } else {
        for (let j = 0; j < ny; j++) {
          this.u[j][0] = inletVelocity;
          this.v[j][0] = 0;
          this.u[j][nx - 1] = this.u[j][nx - 2];
          this.v[j][nx - 1] = this.v[j][nx - 2];
        }
        for (let i = 0; i < nx; i++) {
          this.u[0][i] = this.u[1][i];
          this.v[0][i] = 0;
          this.u[ny - 1][i] = this.u[ny - 2][i];
          this.v[ny - 1][i] = 0;
        }
      }
    }

    // Compute Aerodynamic Lift and Drag Forces
    let dragForce = 0;
    let liftForce = 0;
    for (let j = 1; j < ny - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        if (this.obstacle[j][i]) {
          // Surface normal pressure integration
          if (!this.obstacle[j][i - 1]) dragForce += this.p[j][i - 1] * dy;
          if (!this.obstacle[j][i + 1]) dragForce -= this.p[j][i + 1] * dy;
          if (!this.obstacle[j - 1][i]) liftForce += this.p[j - 1][i] * dx;
          if (!this.obstacle[j + 1][i]) liftForce -= this.p[j + 1][i] * dx;
        }
      }
    }

    const qInf = 0.5 * rho * inletVelocity * inletVelocity;
    const chord = nx * 0.4 * dx;
    const cl = liftForce / (qInf * chord);
    const cd = Math.max(0.005, Math.abs(dragForce) / (qInf * chord));

    return {
      liftForce_N: +liftForce.toFixed(3),
      dragForce_N: +Math.abs(dragForce).toFixed(3),
      liftCoeff_CL: +cl.toFixed(3),
      dragCoeff_CD: +cd.toFixed(3),
      glideRatio: cd > 0 ? +(cl / cd).toFixed(2) : 0,
      grid: { nx, ny, dx, dy },
      velocityField: this.exportVelocityField(),
      pressureField: this.exportPressureField()
    };
  }

  exportVelocityField() {
    const data = [];
    for (let j = 0; j < this.ny; j += 2) {
      for (let i = 0; i < this.nx; i += 2) {
        const u = this.u[j][i];
        const v = this.v[j][i];
        const speed = Math.sqrt(u * u + v * v);
        data.push({
          x: +(i * this.dx).toFixed(3),
          y: +(j * this.dy).toFixed(3),
          u: +u.toFixed(2),
          v: +v.toFixed(2),
          speed: +speed.toFixed(2),
          isSolid: this.obstacle[j][i] === 1
        });
      }
    }
    return data;
  }

  exportPressureField() {
    const data = [];
    for (let j = 0; j < this.ny; j += 2) {
      for (let i = 0; i < this.nx; i += 2) {
        data.push({
          x: +(i * this.dx).toFixed(3),
          y: +(j * this.dy).toFixed(3),
          p: +this.p[j][i].toFixed(1)
        });
      }
    }
    return data;
  }

  /**
   * Experimental static propeller coefficient estimate. This is not a CFD solve
   * and does not supply or validate thrust/torque coefficients.
   */
  static solvePropellerThrust(input) {
    const unavailable = {
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message: 'No sourced propeller performance model or independent reference is configured.'
      }
    };

    if (!input || typeof input !== 'object' || Array.isArray(input)) return unavailable;

    const { rpm, diameterM, airDensityKgM3, thrustCoefficient, torqueCoefficient, coefficientSource } = input;
    const requiredPositiveValues = { rpm, diameterM, airDensityKgM3, thrustCoefficient, torqueCoefficient };
    const missing = Object.entries(requiredPositiveValues).filter(([, value]) => !Number.isFinite(value) || value <= 0);
    if (missing.length > 0 || typeof coefficientSource !== 'string' || !coefficientSource.trim()) {
      return {
        success: false,
        status: 'invalid-input',
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message:
            missing.length > 0
              ? `Explicit positive finite propeller inputs are required: ${missing.map(([name]) => name).join(', ')}.`
              : 'A nonempty coefficientSource label is required.'
        }
      };
    }
    if (!Number.isSafeInteger(rpm) || coefficientSource.length > 1000) {
      return {
        success: false,
        status: 'invalid-input',
        validationLevel: 'experimental',
        error: {
          code: 'INVALID_INPUT',
          message: 'rpm must be a positive safe integer and coefficientSource must not exceed 1000 characters.'
        }
      };
    }

    const rotationalFrequencyHz = rpm / 60;
    const thrustN = thrustCoefficient * airDensityKgM3 * rotationalFrequencyHz ** 2 * diameterM ** 4;
    const torqueNm = torqueCoefficient * airDensityKgM3 * rotationalFrequencyHz ** 2 * diameterM ** 5;
    const shaftPowerW = 2 * Math.PI * rotationalFrequencyHz * torqueNm;
    const idealInducedPowerW = thrustN ** 1.5 / Math.sqrt(2 * airDensityKgM3 * Math.PI * (diameterM / 2) ** 2);
    const figureOfMerit = idealInducedPowerW / shaftPowerW;
    if (
      ![rotationalFrequencyHz, thrustN, torqueNm, shaftPowerW, idealInducedPowerW, figureOfMerit].every(Number.isFinite)
    ) {
      return {
        success: false,
        status: 'numerical-failure',
        validationLevel: 'experimental',
        error: { code: 'NUMERICAL_FAILURE', message: 'The supplied inputs exceed the finite numeric range.' }
      };
    }

    return {
      success: true,
      status: 'experimental',
      validationLevel: 'experimental',
      model: 'static propeller coefficient equations (advance ratio J = 0)',
      coefficientProvenance: 'Caller-supplied coefficients and source label; not independently verified.',
      units: {
        rpm: 'rev/min',
        diameterM: 'm',
        airDensityKgM3: 'kg/m^3',
        thrustCoefficient: 'dimensionless',
        torqueCoefficient: 'dimensionless',
        thrustN: 'N',
        torqueNm: 'N*m',
        shaftPowerW: 'W',
        idealInducedPowerW: 'W'
      },
      inputs: {
        rpm,
        diameterM,
        airDensityKgM3,
        thrustCoefficient,
        torqueCoefficient,
        coefficientSource: coefficientSource.trim()
      },
      advanceRatio: 0,
      rotationalFrequencyHz,
      thrustN,
      torqueNm,
      shaftPowerW,
      idealInducedPowerW,
      figureOfMerit
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CFDSolver2D };
}
