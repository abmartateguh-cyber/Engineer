'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');
const { Quantity, UnitRegistry } = require('../contracts/Quantity');

const { NasaRocketPropulsion } = require('./nasa_rocket_propulsion');
const { SixDofDynamics } = require('./six_dof_dynamics');
const AerospacePropulsionEngine = NasaRocketPropulsion;

// Ensure convective heat transfer and heat flux units are registered in UnitRegistry
if (!UnitRegistry['W/(m^2*K)']) {
  UnitRegistry['W/(m^2*K)'] = { dim: Object.freeze([1, 0, -3, 0, -1, 0, 0]), scale: 1, offset: 0 };
}
if (!UnitRegistry['W/m^2']) {
  UnitRegistry['W/m^2'] = { dim: Object.freeze([1, 0, -3, 0, 0, 0, 0]), scale: 1, offset: 0 };
}

const SUPPORTED_OPERATIONS = Object.freeze([
  'calculate_engine_performance',
  'evaluate_combustion',
  'simulate_ascent_trajectory',
  'calculate_staging_deltav',
  'calculate_isogrid_buckling',
  'regenerative_cooling',
  'turbopump_analysis',
  'compile_rocket_nozzle',
  'run_aerospace_cfd',
  'calculate_orbital_transfer',
  'six_dof_sim'
]);

/**
 * AerospaceEngineAdapter: Standard EngineAdapter for Liquid Rocket Propulsion, Ascent Trajectory, and Isogrid Tank Buckling
 */
class AerospaceEngineAdapter extends EngineAdapter {
  constructor() {
    super('aerospace', 'aerospace-propulsion-engine-adapter', '2.0.0');
    this.propulsion = new AerospacePropulsionEngine();
    this.sixDof = new SixDofDynamics();
    this.supportedOperations = [...SUPPORTED_OPERATIONS];
  }

  describeCapabilities() {
    return {
      domain: 'aerospace',
      name: this.name,
      version: this.version,
      supportedOperations: [...SUPPORTED_OPERATIONS],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  async validate(jobRequest) {
    await super.validate(jobRequest);
    const params = jobRequest.parameters || {};

    if (jobRequest.operation === 'regenerative_cooling') {
      const hasEngine =
        (params.enginePerf && typeof params.enginePerf === 'object') ||
        (params.enginePerformance && typeof params.enginePerformance === 'object') ||
        (params.engineParameters && typeof params.engineParameters === 'object') ||
        (params.engineParams && typeof params.engineParams === 'object') ||
        Number.isFinite(params.throatDiameterM);
      const coolantProps =
        params.coolantProps || params.coolant || (Number.isFinite(params.coolantInletTempK) ? params : null);
      if (!hasEngine || !coolantProps || typeof coolantProps !== 'object') {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'Aerospace "regenerative_cooling" requires explicit enginePerf (or engineParameters) and coolantProps'
        );
      }
    } else if (jobRequest.operation === 'turbopump_analysis') {
      const hasEngine =
        (params.enginePerf && typeof params.enginePerf === 'object') ||
        (params.enginePerformance && typeof params.enginePerformance === 'object') ||
        (params.engineParameters && typeof params.engineParameters === 'object') ||
        (params.engineParams && typeof params.engineParams === 'object') ||
        Number.isFinite(params.throatDiameterM);
      const hasCooling =
        (params.coolingResult && typeof params.coolingResult === 'object') ||
        (params.cooling && typeof params.cooling === 'object') ||
        (params.coolantProps && typeof params.coolantProps === 'object') ||
        Number.isFinite(params.coolantPressureDropPa);
      const pumpProps =
        params.pumpProps ||
        params.turbopumpProps ||
        params.pump ||
        (Number.isFinite(params.fuelPumpSpeedRPM) ? params : null);
      if (!hasEngine || !hasCooling || !pumpProps || typeof pumpProps !== 'object') {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          'Aerospace "turbopump_analysis" requires explicit enginePerf, coolingResult (or coolantProps), and pumpProps'
        );
      }
    } else if (jobRequest.operation === 'compile_rocket_nozzle') {
      const pc =
        params.chamberPressurePa ??
        params.pc ??
        (Number.isFinite(params.chamberPressureBar) ? params.chamberPressureBar * 1e5 : undefined);
      const eps = params.expansionRatio ?? params.eps ?? params.areaRatio;
      const hasThroat =
        Number.isFinite(params.throatRadiusM) ||
        Number.isFinite(params.throatDiameterM) ||
        Number.isFinite(params.throatAreaM2);
      const missing = [];
      if (!Number.isFinite(pc) || pc <= 0) missing.push('chamberPressurePa');
      if (!Number.isFinite(eps) || eps < 1) missing.push('expansionRatio >= 1');
      if (!hasThroat) missing.push('throatRadiusM | throatDiameterM | throatAreaM2');
      if (missing.length > 0) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `Aerospace "compile_rocket_nozzle" requires explicit valid inputs: ${missing.join(', ')}`,
          { missingInputs: missing }
        );
      }
    } else if (jobRequest.operation === 'run_aerospace_cfd') {
      const wedge = params.wedgeHalfAngleDeg ?? params.deflectionAngleDeg;
      const cone = params.coneAngleDeg ?? params.coneHalfAngleDeg;
      const missing = [];
      if (!Number.isFinite(params.machNumber) || params.machNumber <= 1) missing.push('machNumber > 1');
      if (!Number.isFinite(wedge) && !Number.isFinite(cone)) {
        missing.push('wedgeHalfAngleDeg | deflectionAngleDeg | coneAngleDeg');
      } else {
        const halfAngle = Number.isFinite(cone) ? cone : wedge;
        if (!Number.isFinite(halfAngle) || halfAngle <= 0) missing.push('positive half-angle degrees');
      }
      if (
        !Number.isFinite(params.chordM) &&
        !Number.isFinite(params.lengthM) &&
        !Number.isFinite(params.referenceLengthM)
      ) {
        missing.push('chordM | lengthM');
      }
      if (missing.length > 0) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `Aerospace "run_aerospace_cfd" requires explicit valid inputs: ${missing.join(', ')}`,
          { missingInputs: missing }
        );
      }
    } else if (jobRequest.operation === 'calculate_orbital_transfer') {
      const r1 = params.r1Meters ?? params.r1;
      const r2 = params.r2Meters ?? params.r2;
      const biElliptic = Boolean(params.biElliptic) || Number.isFinite(params.intermediateRadiusM);
      const missing = [];
      if (!Number.isFinite(r1) || r1 <= 0) missing.push('r1Meters');
      if (!Number.isFinite(r2) || r2 <= 0) missing.push('r2Meters');
      if (biElliptic) {
        const rA = Number.isFinite(params.intermediateRadiusM) ? params.intermediateRadiusM : params.rA;
        if (!Number.isFinite(rA) || rA <= Math.max(r1, r2)) {
          missing.push('intermediateRadiusM > max(r1Meters, r2Meters)');
        }
      } else if (r2 <= r1) {
        missing.push('r2Meters > r1Meters for outbound Hohmann transfer');
      }
      if (missing.length > 0) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `Aerospace "calculate_orbital_transfer" requires explicit valid inputs: ${missing.join(', ')}`,
          { missingInputs: missing }
        );
      }
    } else if (jobRequest.operation === 'six_dof_sim') {
      const state = params.initialState || {};
      const missing = [];
      for (const key of ['positionM', 'velocityM_s', 'quaternion', 'angularRateRad_s']) {
        if (!Array.isArray(state[key]) || !state[key].every(Number.isFinite)) {
          missing.push(key === 'quaternion' ? 'initialState.quaternion [qw, qx, qy, qz]' : `initialState.${key}`);
        }
      }
      if (!Number.isFinite(params.massKg) || params.massKg <= 0) missing.push('massKg');
      if (!Array.isArray(params.inertiaKgM2) || params.inertiaKgM2.length !== 3)
        missing.push('inertiaKgM2 [Ixx, Iyy, Izz]');
      if (!Number.isFinite(params.dt) || params.dt <= 0) missing.push('dt > 0');
      if (!Number.isInteger(params.steps) || params.steps <= 0) missing.push('positive integer steps');
      if (missing.length > 0) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `Aerospace "six_dof_sim" requires explicit valid inputs: ${missing.join(', ')}`,
          { missingInputs: missing }
        );
      }
    }

    return true;
  }

  _resolveEnginePerformance(params) {
    const existing = params.enginePerf || params.enginePerformance;
    if (existing && typeof existing === 'object') {
      return existing.success !== undefined ? existing : { success: true, ...existing };
    }
    const engineParams = params.engineParameters || params.engineParams || params;
    return this.propulsion.calculateEnginePerformance({
      ...engineParams,
      ambientPressureBar: engineParams.ambientPressureBar !== undefined ? engineParams.ambientPressureBar : 1.01325
    });
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({
        jobId,
        type: JobEventType.STARTED,
        message: `Starting aerospace operation "${jobRequest.operation}"`
      })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'calculate_engine_performance': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Calculating rocket engine chamber and nozzle performance'
            })
          );
          const engineParams = {
            ...params,
            ambientPressureBar: params.ambientPressureBar !== undefined ? params.ambientPressureBar : 1.01325
          };
          outputData = this.propulsion.calculateEnginePerformance(engineParams);
          break;
        }

        case 'evaluate_combustion': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Evaluating propellant combustion temperature and characteristic velocity'
            })
          );
          outputData = this.propulsion.evaluateCombustionEquilibrium(
            params.propellantType || 'LOX_LCH4',
            params.chamberPressureBar || 100.0,
            params.ofRatio || 3.4
          );
          break;
        }

        case 'simulate_ascent_trajectory': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Simulating ascent launch trajectory through 1976 Standard Atmosphere'
            })
          );
          outputData = this.propulsion.simulateAscentTrajectory(params);
          break;
        }

        case 'calculate_staging_deltav': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Evaluating Tsiolkovsky multi-stage delta-V budget'
            })
          );
          outputData = this.propulsion.calculateStagingDeltaV(params);
          break;
        }

        case 'calculate_isogrid_buckling': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Screening triangular isogrid skin and rib instability'
            })
          );
          outputData = this.propulsion.calculateIsogridTankBuckling(params);
          break;
        }

        case 'regenerative_cooling': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 45,
              message: 'Evaluating Bartz convective throat heat transfer and regenerative cooling'
            })
          );
          const enginePerf = this._resolveEnginePerformance(params);
          if (!enginePerf || enginePerf.success !== true) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              enginePerf?.error || 'Invalid engine performance inputs for regenerative_cooling',
              { missingInputs: enginePerf?.missingInputs || [] }
            );
          }
          const coolantProps = params.coolantProps || params.coolant || params;
          const cooling = this.propulsion.calculateBartzRegenerativeCooling(enginePerf, coolantProps);
          if (!cooling || cooling.success !== true) {
            const errCode =
              cooling?.status === 'numerical_failure' ? OmniErrorCode.NUMERICAL_FAILURE : OmniErrorCode.INVALID_INPUT;
            throw new OmniError(errCode, cooling?.error || 'Regenerative cooling calculation failed', {
              missingInputs: cooling?.missingInputs || []
            });
          }

          const heatFluxWm2 = cooling.heatFluxThroatMW_m2 * 1e6;
          const totalHeatTransferW = heatFluxWm2 * cooling.effectiveHeatTransferAreaM2;

          const quantities = {
            gasSideHeatTransferCoeff: Quantity.from(cooling.gasSideCoefficientWm2K, 'W/(m^2*K)'),
            recoveryTemperature: Quantity.from(cooling.recoveryTempThroatK, 'K'),
            gasSideWallTemperature: Quantity.from(cooling.gasSideWallTempK, 'K'),
            coolantSideWallTemperature: Quantity.from(cooling.coolantSideWallTempK, 'K'),
            coolantInletTemperature: Quantity.from(cooling.coolantInletTempK, 'K'),
            coolantOutletTemperature: Quantity.from(cooling.coolantOutletTempK, 'K'),
            coolantTemperatureRise: Quantity.from(cooling.coolantTempRiseK, 'K'),
            throatHeatFlux: Quantity.from(heatFluxWm2, 'W/m^2'),
            totalHeatTransferPower: Quantity.from(totalHeatTransferW, 'W'),
            coolantChannelLength: Quantity.from(cooling.coolantChannelLengthM, 'm'),
            wallThickness: Quantity.from(cooling.inputs.wallThicknessM, 'm')
          };

          outputData = {
            ...cooling,
            ...quantities,
            quantities
          };
          break;
        }

        case 'turbopump_analysis': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 45,
              message: 'Evaluating liquid rocket turbopump shaft power balance and cavitation margin'
            })
          );
          const enginePerf = this._resolveEnginePerformance(params);
          if (!enginePerf || enginePerf.success !== true) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              enginePerf?.error || 'Invalid engine performance inputs for turbopump_analysis',
              { missingInputs: enginePerf?.missingInputs || [] }
            );
          }

          let coolingResult = params.coolingResult || params.cooling || null;
          if (coolingResult && typeof coolingResult === 'object') {
            coolingResult = coolingResult.success !== undefined ? coolingResult : { success: true, ...coolingResult };
          } else if (Number.isFinite(params.coolantPressureDropPa) && params.coolantPressureDropPa > 0) {
            coolingResult = { success: true, coolantPressureDropPa: params.coolantPressureDropPa };
          } else if (params.coolantProps && typeof params.coolantProps === 'object') {
            coolingResult = this.propulsion.calculateBartzRegenerativeCooling(enginePerf, params.coolantProps);
          }

          const pumpProps = params.pumpProps || params.turbopumpProps || params.pump || params;
          const tp = this.propulsion.calculateTurbopumpSystem(enginePerf, coolingResult, pumpProps);
          if (!tp || tp.success !== true) {
            const errCode =
              tp?.status === 'numerical_failure' ? OmniErrorCode.NUMERICAL_FAILURE : OmniErrorCode.INVALID_INPUT;
            throw new OmniError(errCode, tp?.error || 'Turbopump system analysis failed', {
              missingInputs: tp?.missingInputs || []
            });
          }

          const quantities = {
            fuelPumpPower: Quantity.from(tp.fuelPump.pumpPowerW, 'W'),
            oxidizerPumpPower: Quantity.from(tp.oxPump.pumpPowerW, 'W'),
            totalPumpingPower: Quantity.from(tp.totalPumpingPowerMW * 1e6, 'W'),
            turbineShaftPower: Quantity.from(tp.turbineShaftPowerMW * 1e6, 'W'),
            fuelImpellerDiameter: Quantity.from(tp.fuelImpellerDiameterMm / 1000.0, 'm'),
            oxidizerImpellerDiameter: Quantity.from(tp.oxImpellerDiameterMm / 1000.0, 'm'),
            npshAvailableOx: Quantity.from(tp.npshAvailableOxM, 'm'),
            npshRequiredOx: Quantity.from(tp.npshRequiredOxM, 'm')
          };

          outputData = {
            ...tp,
            ...quantities,
            quantities
          };
          break;
        }

        case 'compile_rocket_nozzle': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 45,
              message: 'Compiling isentropic nozzle performance with Rao parabolic bell contour'
            })
          );
          const nozzle = this.propulsion.compileRocketNozzle(params);
          if (!nozzle || nozzle.success !== true) {
            const errCode =
              nozzle?.status === 'numerical-failure' ? OmniErrorCode.NUMERICAL_FAILURE : OmniErrorCode.INVALID_INPUT;
            throw new OmniError(errCode, nozzle?.error?.message || 'Rocket nozzle compilation failed');
          }
          outputData = nozzle;
          break;
        }

        case 'run_aerospace_cfd': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 45,
              message: 'Solving supersonic shock-expansion surface pressures and force coefficients'
            })
          );
          const cfd = this.propulsion.runAerospaceCFD(params);
          if (!cfd || cfd.success !== true) {
            const errCode =
              cfd?.status === 'numerical-failure' ? OmniErrorCode.NUMERICAL_FAILURE : OmniErrorCode.INVALID_INPUT;
            throw new OmniError(errCode, cfd?.error?.message || 'Aerospace CFD analysis failed', {
              missingInputs: cfd?.error?.requiredFields || []
            });
          }
          outputData = cfd;
          break;
        }

        case 'calculate_orbital_transfer': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 45,
              message: 'Evaluating Hohmann (or bi-elliptic) orbital transfer impulse budget'
            })
          );
          const transfer = this.propulsion.calculateOrbitalTransfer(params);
          if (!transfer || transfer.success !== true) {
            const errCode =
              transfer?.status === 'numerical-failure' ? OmniErrorCode.NUMERICAL_FAILURE : OmniErrorCode.INVALID_INPUT;
            throw new OmniError(errCode, transfer?.error?.message || 'Orbital transfer analysis failed');
          }
          outputData = transfer;
          break;
        }

        case 'six_dof_sim': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 45,
              message: 'Integrating 6-DOF rigid-body flight dynamics (RK4)'
            })
          );
          const sim = this.sixDof.simulateSixDof(params);
          if (!sim || sim.success !== true) {
            const errCode =
              sim?.status === 'numerical-failure' ? OmniErrorCode.NUMERICAL_FAILURE : OmniErrorCode.INVALID_INPUT;
            throw new OmniError(errCode, sim?.error?.message || '6-DOF simulation failed', {
              missingInputs: sim?.error?.missingInputs || []
            });
          }
          outputData = sim;
          break;
        }

        default:
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `Operation "${jobRequest.operation}" not implemented in AerospaceEngineAdapter`
          );
      }

      onEvent(
        new JobEvent({
          jobId,
          type: JobEventType.PROGRESS,
          progressPercent: 100,
          message: 'Aerospace operation complete'
        })
      );

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData,
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

AerospaceEngineAdapter.SUPPORTED_OPERATIONS = SUPPORTED_OPERATIONS;

module.exports = {
  AerospaceEngineAdapter,
  AerospacePropulsionEngine,
  SUPPORTED_OPERATIONS
};
