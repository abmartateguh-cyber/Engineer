'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { BlockDiagramGraph, StateSpaceEngine } = require('../dynamic_simulink/block_graph');
const { ModelPredictiveController } = require('../dynamic_simulink/model_predictive_control');
const { FmiMasterEngine, FmuSlave } = require('../cosim/fmi_master_engine');
const { ExtendedKalmanFilter } = require('../dynamic_simulink/extended_kalman_filter');

/**
 * ControlsEngineAdapter: Standard EngineAdapter for Dynamic Controls, Simscape DAE, and FMI Co-Simulation
 */
class ControlsEngineAdapter extends EngineAdapter {
  constructor() {
    super('controls', 'controls-cosim-engine-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: 'controls',
      name: this.name,
      version: this.version,
      supportedOperations: ['simulate_block_diagram', 'solve_state_space', 'solve_mpc', 'estimate_ekf'],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({
        jobId,
        type: JobEventType.STARTED,
        message: `Starting controls operation "${jobRequest.operation}"`
      })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      let residualHistory = [];
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'simulate_block_diagram': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 20,
              message: 'Constructing dynamic block diagram graph'
            })
          );
          const graph = new BlockDiagramGraph();

          if (Array.isArray(params.blocks)) {
            for (const b of params.blocks) {
              graph.addBlock(b.type, b.name, b.params || {}, b.x || 100, b.y || 100);
            }
          }

          if (Array.isArray(params.connections)) {
            for (const c of params.connections) {
              graph.connect(c.fromBlock, c.toBlock, c.fromPort || 0, c.toPort || 0);
            }
          }

          const tEnd = Number(params.tEnd || 10.0);
          const dt = Number(params.dt || 0.01);

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: `Simulating block graph to t=${tEnd}s (dt=${dt}s)`
            })
          );
          outputData = graph.simulate(tEnd, dt);
          break;
        }

        case 'solve_state_space': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 25,
              message: 'Initializing continuous state-space matrices (A, B, C, D)'
            })
          );
          const { A, B, C, D, initialX, tEnd = 5.0, dt = 0.01, u = [1.0] } = params;

          if (!A || !B || !C || !D) {
            throw new OmniError(OmniErrorCode.INVALID_INPUT, 'State space requires A, B, C, D matrices');
          }

          const ss = new StateSpaceEngine(A, B, C, D, initialX);
          const steps = Math.ceil(tEnd / dt);
          const time = [];
          const states = [];
          const outputs = [];

          for (let step = 0; step <= steps; step++) {
            if (signal?.aborted) {
              throw new OmniError(OmniErrorCode.CANCELLED, 'Execution aborted during state-space integration');
            }
            const t = step * dt;
            time.push(t);
            states.push(Array.from(ss.x));

            // Compute y = C*x + D*u
            const y = [];
            for (let i = 0; i < C.length; i++) {
              let val = 0;
              for (let j = 0; j < ss.n; j++) val += C[i][j] * ss.x[j];
              for (let k = 0; k < ss.m; k++) val += D[i][k] * (u[k] || 0);
              y.push(val);
            }
            outputs.push(y);

            if (step < steps) {
              ss.stepRK4(u, dt);
            }

            if (step % Math.max(1, Math.floor(steps / 5)) === 0) {
              const pct = Math.round(25 + (step / steps) * 70);
              onEvent(
                new JobEvent({
                  jobId,
                  type: JobEventType.PROGRESS,
                  progressPercent: pct,
                  message: `Integrated to t=${t.toFixed(2)}s`
                })
              );
            }
          }

          outputData = {
            time,
            states,
            outputs,
            finalState: Array.from(ss.x),
            dimensions: { states: ss.n, inputs: ss.m, outputs: ss.p }
          };
          break;
        }

        case 'fmi_cosimulation': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Setting up FMI 2.0/3.0 co-simulation master'
            })
          );
          const duration = Number(params.duration ?? params.stopTime ?? params.tEnd ?? params.totalTimeSec ?? 1.0);
          const dt = Number(params.dt ?? params.stepSize ?? params.defaultStepSize ?? 0.01);
          if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(dt) || dt <= 0) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'FMI co-simulation requires positive finite duration and dt (stepSize)'
            );
          }

          const master = new FmiMasterEngine({
            startTime: Number(params.startTime || 0),
            stopTime: duration,
            defaultStepSize: dt,
            minStepSize: params.minStepSize || 1e-6,
            maxStepSize: params.maxStepSize || Math.max(dt, 0.01),
            scheme: params.scheme || 'gauss_seidel',
            adaptiveStep: params.adaptiveStep !== undefined ? Boolean(params.adaptiveStep) : false,
            tolerance: params.tolerance || 1e-5
          });
          master.stepSize = dt;
          master.stopTime = duration;

          // Register slaves if provided
          const slaveInputList = Array.isArray(params.slaves)
            ? params.slaves
            : Array.isArray(params.fmus)
              ? params.fmus
              : [];
          const slaveByName = new Map();
          for (let i = 0; i < slaveInputList.length; i++) {
            const s = slaveInputList[i];
            const slave = s instanceof FmuSlave ? s : new FmuSlave({ instanceName: `FMU_${i + 1}`, ...s });
            if (typeof s.doStep === 'function' && !(s instanceof FmuSlave)) {
              const customDoStep = s.doStep;
              slave.doStep = function (t, h) {
                const res = customDoStep.call(this, t, h, this);
                this.time = t + h;
                return res !== false;
              };
            } else if (typeof s.stepFn === 'function') {
              const customStepFn = s.stepFn;
              slave.doStep = function (t, h) {
                const res = customStepFn(t, h, this);
                this.time = t + h;
                return res !== false;
              };
            }
            master.addSlave(slave);
            slaveByName.set(slave.instanceName, slave);
          }

          // Register connections if provided
          if (Array.isArray(params.connections)) {
            for (const conn of params.connections) {
              const resolveSlave = (ref) => {
                if (ref instanceof FmuSlave) return ref;
                if (typeof ref === 'number') return master.slaves[ref];
                if (typeof ref === 'string') return slaveByName.get(ref);
                return null;
              };
              const srcSlave = resolveSlave(conn.sourceSlave ?? conn.fromSlave ?? conn.from);
              const tgtSlave = resolveSlave(conn.targetSlave ?? conn.toSlave ?? conn.to);
              if (srcSlave && tgtSlave) {
                master.addConnection(
                  srcSlave,
                  Number(conn.sourceVr ?? conn.fromVr ?? 0),
                  tgtSlave,
                  Number(conn.targetVr ?? conn.toVr ?? 0)
                );
              }
            }
          }

          const hasLoop = master.hasAlgebraicLoop();
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 60,
              message: `Algebraic loop check: ${hasLoop ? 'DETECTED' : 'NONE'}`
            })
          );

          let loopResolution = null;
          if (hasLoop) {
            loopResolution = master.solveAlgebraicLoop(
              params.maxIterations || 50,
              params.omega || 0.8,
              params.tolerance || 1e-6
            );
          }

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 80,
              message: `Executing FMI co-simulation master loop (duration=${duration}s, dt=${dt}s)`
            })
          );
          const simResult = master.simulate(duration, dt);

          residualHistory = simResult.timeSeries.map((snap, idx) => ({
            iteration: idx,
            step: idx,
            time: snap.t,
            residual: loopResolution ? loopResolution.maxResidual : 0.0
          }));

          outputData = {
            slaveCount: master.slaves.length,
            hasAlgebraicLoop: hasLoop,
            loopResolution,
            stepSize: master.stepSize,
            duration,
            dt,
            totalSteps: simResult.totalSteps,
            rejectedSteps: simResult.rejectedSteps,
            converged: simResult.converged,
            timeSeries: simResult.timeSeries,
            stepHistory: simResult.timeSeries
          };
          break;
        }

        case 'solve_mpc': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Formulating QP active-set constrained MPC problem'
            })
          );
          const nx = params.A.length;
          const nu = params.B[0].length;
          const ny = params.C.length;

          const mpc = new ModelPredictiveController({
            A: params.A,
            B: params.B,
            C: params.C,
            predictionHorizon: params.predictionHorizon || params.Np || 10,
            controlHorizon: params.controlHorizon || params.Nc || 3,
            Q: Array.isArray(params.Q) ? params.Q : new Array(ny).fill(1.0),
            R: Array.isArray(params.R) ? params.R : new Array(nu).fill(0.1),
            Rdelta: Array.isArray(params.Rdelta) ? params.Rdelta : new Array(nu).fill(0.01),
            uMin: Array.isArray(params.uMin) ? params.uMin : new Array(nu).fill(-10.0),
            uMax: Array.isArray(params.uMax) ? params.uMax : new Array(nu).fill(10.0),
            deltaUMax: Array.isArray(params.deltaUMax) ? params.deltaUMax : new Array(nu).fill(5.0),
            initialControl: Array.isArray(params.initialControl) ? params.initialControl : new Array(nu).fill(0.0)
          });

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 70,
              message: 'Solving dual active-set Goldfarb-Idnani QP'
            })
          );
          const sol = mpc.computeControlAction(
            params.x0 || new Array(nx).fill(0),
            params.reference || new Array(ny).fill(1)
          );
          outputData = {
            optimalControl: sol.u,
            optimalSequence: sol.optimalSequence,
            converged: sol.qpConverged,
            cost: sol.cost
          };
          break;
        }

        case 'estimate_ekf': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 20,
              message: 'Initializing 10-state quaternion Extended Kalman Filter'
            })
          );
          const ekf = new ExtendedKalmanFilter();
          if (params.initialState && Array.isArray(params.initialState)) {
            for (let i = 0; i < Math.min(10, params.initialState.length); i++) {
              ekf.x[i] = params.initialState[i];
            }
          }

          const steps = Array.isArray(params.steps)
            ? params.steps
            : [{ dt: params.dt || 0.01, gyro: params.gyro, accel: params.accel }];
          const trajectory = [];

          for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            ekf.predict(s.gyro || [0, 0, 0], s.accel || [0, 0, -9.80665], s.dt || 0.01);
            if (s.baroAlt !== undefined) {
              ekf.updateBarometer(s.baroAlt);
            }
            if (s.gpsPos && Array.isArray(s.gpsPos)) {
              ekf.updateGPSPosition(s.gpsPos);
            }
            if (params.recordTrajectory) {
              const euler = ekf.getEulerAngles();
              trajectory.push({
                position: [ekf.x[0], ekf.x[1], ekf.x[2]],
                velocity: [ekf.x[3], ekf.x[4], ekf.x[5]],
                quaternion: [ekf.x[6], ekf.x[7], ekf.x[8], ekf.x[9]],
                eulerDeg: euler
              });
            }
          }

          const finalEuler = ekf.getEulerAngles();
          outputData = {
            finalState: {
              position: [ekf.x[0], ekf.x[1], ekf.x[2]],
              velocity: [ekf.x[3], ekf.x[4], ekf.x[5]],
              quaternion: [ekf.x[6], ekf.x[7], ekf.x[8], ekf.x[9]],
              eulerDeg: finalEuler
            },
            attitude: {
              quaternion: [ekf.x[6], ekf.x[7], ekf.x[8], ekf.x[9]],
              eulerDeg: finalEuler
            },
            stepsProcessed: steps.length,
            trajectory: params.recordTrajectory ? trajectory : undefined
          };
          break;
        }

        default:
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `Operation "${jobRequest.operation}" not implemented in ControlsEngineAdapter`
          );
      }

      onEvent(
        new JobEvent({
          jobId,
          type: JobEventType.PROGRESS,
          progressPercent: 100,
          message: 'Controls operation complete'
        })
      );

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData,
        residualHistory,
        backendName: this.name,
        backendVersion: this.version,
        executionDurationMs: durationMs,
        peakMemoryMb: process.memoryUsage().heapUsed / (1024 * 1024)
      });

      onEvent(new JobEvent({ jobId, type: JobEventType.COMPLETED, message: `Completed in ${durationMs}ms` }));
      return result;
    } catch (err) {
      onEvent(new JobEvent({ jobId, type: JobEventType.FAILED, message: err.message }));
      throw err;
    }
  }
}

module.exports = {
  ControlsEngineAdapter
};
