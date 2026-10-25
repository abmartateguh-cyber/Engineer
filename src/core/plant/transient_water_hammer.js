/**
 * Simplified experimental 1D water-hammer calculation example.
 *
 * The bundled assumptions and boundary conditions have not been independently
 * validated. This module does not assess ASME B31.3/B31.4 compliance or provide
 * a design recommendation.
 */

'use strict';

const GRAVITY = 9.80665; // m/s^2

class TransientWaterHammerSolver {
  /**
   * Calculates Korteweg acoustic wave speed (a) in fluid-filled elastic conduit
   * @param {Object} conduit
   * @param {number} [conduit.fluidDensity=998.2] - rho (kg/m^3)
   * @param {number} [conduit.fluidBulkModulus=2.19e9] - K (Pa) (e.g. 2.19 GPa for water at 20°C)
   * @param {number} [conduit.pipeElasticModulus=2.0e11] - E (Pa) (e.g. 200 GPa for Carbon Steel)
   * @param {number} [conduit.pipeInnerDiameter=0.30] - D (m)
   * @param {number} [conduit.pipeWallThickness=0.008] - e (m)
   * @param {number} [conduit.restraintFactor=1.0] - c1 (1.0 for anchored pipe against axial motion)
   * @returns {number} Acoustic wave propagation speed a (m/s)
   */
  static calculateWaveSpeed(conduit) {
    const names = [
      'fluidDensity',
      'fluidBulkModulus',
      'pipeElasticModulus',
      'pipeInnerDiameter',
      'pipeWallThickness',
      'restraintFactor'
    ];
    const missing = names.filter((name) => !Number.isFinite(conduit?.[name]));
    if (missing.length)
      throw new TypeError(`calculateWaveSpeed requires explicit finite inputs: ${missing.join(', ')}.`);
    const {
      fluidDensity: rho,
      fluidBulkModulus: K,
      pipeElasticModulus: E,
      pipeInnerDiameter: D,
      pipeWallThickness: e,
      restraintFactor: c1
    } = conduit;
    if (rho <= 0 || K <= 0 || E <= 0 || D <= 0 || e <= 0 || e >= D / 2 || c1 < 0) {
      throw new RangeError('Wave-speed inputs are outside the supported positive geometry and property ranges.');
    }

    // a = sqrt( (K / rho) / (1 + (K / E) * (D / e) * c1) )
    const denominator = 1.0 + (K / E) * (D / e) * c1;
    const waveSpeed = Math.sqrt(K / rho / denominator);
    return Number(waveSpeed.toFixed(2));
  }

  /**
   * Computes classic Joukowsky maximum instantaneous pressure surge
   * Delta_P = rho * a * Delta_v
   * Delta_H = (a * Delta_v) / g
   * @param {number} waveSpeed - a (m/s)
   * @param {number} initialVelocity - v0 (m/s)
   * @param {number} [density=998.2] - rho (kg/m^3)
   * @returns {{surgePressurePa: number, surgeHeadM: number}}
   */
  static joukowskySurge(waveSpeed, initialVelocity, density) {
    if (
      !Number.isFinite(waveSpeed) ||
      waveSpeed <= 0 ||
      !Number.isFinite(initialVelocity) ||
      !Number.isFinite(density) ||
      density <= 0
    ) {
      throw new TypeError('joukowskySurge requires positive waveSpeed and density and a finite initialVelocity.');
    }
    const deltaP = density * waveSpeed * initialVelocity;
    const deltaH = (waveSpeed * initialVelocity) / GRAVITY;
    return {
      surgePressurePa: Number(deltaP.toFixed(2)),
      surgeHeadM: Number(deltaH.toFixed(2))
    };
  }

  /**
   * Runs 1D Method of Characteristics (MOC) hydraulic transient simulation
   * @param {Object} params
   * @param {number} [params.pipeLength=1000] - Total pipeline length L (m)
   * @param {number} [params.pipeDiameter=0.3] - Diameter D (m)
   * @param {number} [params.pipeWallThickness=0.008] - Thickness e (m)
   * @param {number} [params.darcyFrictionFactor=0.018] - f (Darcy friction factor)
   * @param {number} [params.reservoirHead=100.0] - H_res (m of fluid, constant upstream head)
   * @param {number} [params.steadyFlowRate=0.15] - Q0 (m^3/s, steady state initial discharge)
   * @param {number} [params.valveClosureTime=0.5] - Tc (seconds to fully close downstream valve)
   * @param {string} [params.valveClosureLaw='linear'] - 'instantaneous', 'linear', 's_curve'
   * @param {number} [params.simulationDuration=5.0] - Total simulation duration t_max (s)
   * @param {number} [params.reaches=20] - Number of spatial reach divisions N
   * @param {Object} [params.surgeTank] - Optional surge mitigation vessel { volumeM3, polytropicGamma }
   * @returns {Object} Experimental transient estimates and sampled history
   */
  static solveTransientMOC(params) {
    const required = [
      'pipeLength',
      'pipeDiameter',
      'pipeWallThickness',
      'darcyFrictionFactor',
      'reservoirHead',
      'steadyFlowRate',
      'valveClosureTime',
      'valveClosureLaw',
      'simulationDuration',
      'reaches',
      'fluidDensity',
      'fluidBulkModulus',
      'pipeElasticModulus',
      'restraintFactor'
    ];
    const missing = required.filter((name) => params?.[name] === undefined || params[name] === null);
    if (missing.length) throw new TypeError(`solveTransientMOC requires explicit inputs: ${missing.join(', ')}.`);
    if (params.surgeTank !== undefined) {
      throw new TypeError('A surge-tank model is unavailable; no surge-tank calculation was run.');
    }
    const finiteNames = required.filter((name) => name !== 'valveClosureLaw' && name !== 'reaches');
    const nonFinite = finiteNames.filter((name) => !Number.isFinite(params[name]));
    if (nonFinite.length || !Number.isInteger(params.reaches) || params.reaches < 4) {
      throw new TypeError(
        `solveTransientMOC requires finite physical inputs and integer reaches >= 4${nonFinite.length ? `; invalid: ${nonFinite.join(', ')}` : ''}.`
      );
    }
    const {
      pipeLength: L,
      pipeDiameter: D,
      pipeWallThickness: e,
      darcyFrictionFactor: f,
      reservoirHead: H_res,
      steadyFlowRate: Q0,
      valveClosureTime: Tc,
      valveClosureLaw: closureLaw,
      simulationDuration: tMax,
      reaches: N,
      fluidDensity: rho,
      fluidBulkModulus,
      pipeElasticModulus,
      restraintFactor
    } = params;
    if (
      L <= 0 ||
      D <= 0 ||
      e <= 0 ||
      e >= D / 2 ||
      f < 0 ||
      H_res <= 0 ||
      Q0 < 0 ||
      Tc <= 0 ||
      tMax <= 0 ||
      rho <= 0 ||
      fluidBulkModulus <= 0 ||
      pipeElasticModulus <= 0 ||
      restraintFactor < 0 ||
      !['instantaneous', 'linear', 's_curve'].includes(closureLaw)
    ) {
      throw new RangeError('Transient MOC inputs are outside the supported ranges.');
    }

    const A = (Math.PI * D * D) / 4.0;
    const waveSpeed = this.calculateWaveSpeed({
      fluidDensity: rho,
      fluidBulkModulus,
      pipeElasticModulus,
      pipeInnerDiameter: D,
      pipeWallThickness: e,
      restraintFactor
    });

    const dx = L / N;
    const dt = dx / waveSpeed; // Strict Courant condition Cr = 1.0
    const numTimeSteps = Math.ceil(tMax / dt);
    if (!Number.isSafeInteger(numTimeSteps) || numTimeSteps > 1_000_000) {
      throw new RangeError('Transient MOC request exceeds the 1,000,000-step work limit.');
    }

    // MOC Coefficients:
    // B = a / (g * A)
    // R = f * dx / (2 * g * D * A^2)
    const B = waveSpeed / (GRAVITY * A);
    const R = (f * dx) / (2.0 * GRAVITY * D * A * A);

    // Initial steady-state condition (linear hydraulic grade line from friction)
    // H(x) = H_res - (f * x / D) * (v0^2 / (2*g))
    const v0 = Q0 / A;
    const H_prev = new Float64Array(N + 1);
    const Q_prev = new Float64Array(N + 1);
    const H_curr = new Float64Array(N + 1);
    const Q_curr = new Float64Array(N + 1);

    for (let i = 0; i <= N; i++) {
      const x = i * dx;
      const hFriction = ((f * x) / D) * ((v0 * v0) / (2.0 * GRAVITY));
      H_prev[i] = H_res - hFriction;
      Q_prev[i] = Q0;
    }

    const H_at_valve = [H_prev[N]];
    const Q_at_valve = [Q_prev[N]];
    const timeHistory = [0.0];

    let maxHeadObserved = H_prev[0];
    let minHeadObserved = H_prev[0];
    let maxPressureLocationX = 0;

    // Precompute valve closure function tau(t)
    const getTau = (t) => {
      if (t <= 0) return 1.0;
      if (t >= Tc) return 0.0;
      if (closureLaw === 'instantaneous') return 0.0;
      if (closureLaw === 's_curve') {
        const s = t / Tc;
        return 0.5 * (1.0 + Math.cos(Math.PI * s));
      }
      // Linear
      return 1.0 - t / Tc;
    };

    // Time-marching MOC
    for (let step = 1; step <= numTimeSteps; step++) {
      const currentTime = step * dt;

      // 1. Upstream Boundary (Reservoir at Node 0): Constant Head H_res
      // Characteristic equation from Node 1 (C-):
      // H_0 = C_M + B * Q_0  ==>  Q_0 = (H_res - C_M) / B
      const CM_upstream = H_prev[1] - B * Q_prev[1] + R * Q_prev[1] * Math.abs(Q_prev[1]);
      H_curr[0] = H_res;
      Q_curr[0] = (H_res - CM_upstream) / B;

      // 2. Interior Nodes (1 to N-1)
      for (let i = 1; i < N; i++) {
        // C+ from left (i-1)
        const CP = H_prev[i - 1] + B * Q_prev[i - 1] - R * Q_prev[i - 1] * Math.abs(Q_prev[i - 1]);
        // C- from right (i+1)
        const CM = H_prev[i + 1] - B * Q_prev[i + 1] + R * Q_prev[i + 1] * Math.abs(Q_prev[i + 1]);

        H_curr[i] = (CP + CM) / 2.0;
        Q_curr[i] = (CP - CM) / (2.0 * B);

        if (H_curr[i] > maxHeadObserved) {
          maxHeadObserved = H_curr[i];
          maxPressureLocationX = i * dx;
        }
        if (H_curr[i] < minHeadObserved) {
          minHeadObserved = H_curr[i];
        }
      }

      // 3. Downstream Boundary (Valve at Node N)
      // C+ from Node N-1: H_N = CP - B * Q_N
      const CP_valve = H_prev[N - 1] + B * Q_prev[N - 1] - R * Q_prev[N - 1] * Math.abs(Q_prev[N - 1]);
      const tau = getTau(currentTime);

      if (tau <= 1e-6) {
        // Fully closed valve: Q_N = 0
        Q_curr[N] = 0.0;
        H_curr[N] = CP_valve;
      } else {
        // Orifice equation: Q_N = (tau * Q0) * sqrt(H_N / H0_steady)
        // With H_N = CP - B * Q_N:
        // Quadratic: (Q_N)^2 + (Cv^2 * B) * Q_N - Cv^2 * CP = 0
        const H0_valve = H_prev[N];
        const Cv = (tau * Q0) / Math.sqrt(Math.max(0.1, H0_valve));
        const bCoeff = Cv * Cv * B;
        const cCoeff = -Cv * Cv * CP_valve;
        const disc = bCoeff * bCoeff - 4.0 * cCoeff;
        if (disc >= 0) {
          Q_curr[N] = (-bCoeff + Math.sqrt(disc)) / 2.0;
        } else {
          Q_curr[N] = 0.0;
        }
        H_curr[N] = CP_valve - B * Q_curr[N];
      }

      if (H_curr[N] > maxHeadObserved) {
        maxHeadObserved = H_curr[N];
        maxPressureLocationX = L;
      }
      if (H_curr[N] < minHeadObserved) {
        minHeadObserved = H_curr[N];
      }

      // Copy curr to prev for next timestep
      H_prev.set(H_curr);
      Q_prev.set(Q_curr);

      // Record valve timeline
      if (step % Math.max(1, Math.floor(numTimeSteps / 100)) === 0) {
        timeHistory.push(Number(currentTime.toFixed(3)));
        H_at_valve.push(Number(H_curr[N].toFixed(2)));
        Q_at_valve.push(Number(Q_curr[N].toFixed(4)));
      }
    }

    const maxPressurePaEstimate = maxHeadObserved * rho * GRAVITY;
    const peakHoopStressMpaEstimate = (maxPressurePaEstimate * D) / (2.0 * e * 1e6);

    return {
      success: true,
      validationLevel: 'experimental',
      screeningStatus: 'EXPERIMENTAL_ESTIMATE_ONLY',
      model: 'simplified-1d-moc-example',
      codeAssessment: 'NOT_PERFORMED',
      pipeLength: L,
      waveSpeed,
      courantNumber: 1.0,
      spatialReachCount: N,
      timeStepDt: Number(dt.toFixed(5)),
      totalStepsExecuted: numTimeSteps,
      initialDischarge: Q0,
      maxHeadObserved: Number(maxHeadObserved.toFixed(2)),
      minHeadObserved: Number(minHeadObserved.toFixed(2)),
      maxPressureBarEstimate: Number((maxPressurePaEstimate / 1e5).toFixed(2)),
      peakHoopStressMpaEstimate: Number(peakHoopStressMpaEstimate.toFixed(2)),
      maxPressureLocationX: Number(maxPressureLocationX.toFixed(2)),
      joukowskyTheoreticalMaxHead: this.joukowskySurge(waveSpeed, v0, rho).surgeHeadM,
      valveTelemetry: {
        timeHistory,
        headHistory: H_at_valve,
        flowHistory: Q_at_valve
      }
    };
  }
}

module.exports = {
  GRAVITY,
  TransientWaterHammerSolver
};
