'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { PengRobinsonEOS } = require('./peng_robinson_eos');
const { TransientWaterHammerSolver } = require('./transient_water_hammer');
const { VLEPhaseEnvelopeEngine } = require('./vle_envelope');

/**
 * PlantEngineAdapter: Standard EngineAdapter for Chemical Process Thermodynamics, VLE Flash, Distillation, and Water Hammer Hydraulics
 */
class PlantEngineAdapter extends EngineAdapter {
  constructor() {
    super('plant', 'plant-process-engine-adapter', '2.0.0');
  }

  describeCapabilities() {
    return {
      domain: 'plant',
      name: this.name,
      version: this.version,
      supportedOperations: [
        'solve_vle_flash',
        'calculate_nrtl_activity',
        'calculate_water_hammer',
        'generate_vle_envelope'
      ],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
  }

  async validate(jobRequest) {
    await super.validate(jobRequest);
    const params = jobRequest.parameters;
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Plant operations require an explicit parameter object');
    }

    const requireFields = (fields, operation) => {
      const missing = fields.filter((field) => params[field] === undefined || params[field] === null);
      if (missing.length) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `${operation} requires explicit inputs: ${missing.join(', ')}`
        );
      }
    };
    const requireFinite = (fields, operation) => {
      const invalid = fields.filter((field) => !Number.isFinite(params[field]));
      if (invalid.length) {
        throw new OmniError(
          OmniErrorCode.INVALID_INPUT,
          `${operation} requires finite numeric inputs: ${invalid.join(', ')}`
        );
      }
    };
    const requireOneOf = (fields, operation) => {
      if (!fields.some((field) => params[field] !== undefined && params[field] !== null)) {
        throw new OmniError(OmniErrorCode.INVALID_INPUT, `${operation} requires one of: ${fields.join(', ')}`);
      }
    };

    switch (jobRequest.operation) {
      case 'solve_vle_flash': {
        requireFields(['components', 'k_ij', 'temperatureK', 'pressurePa', 'maxIter', 'tol'], jobRequest.operation);
        requireOneOf(['feedComposition', 'z'], jobRequest.operation);
        if (!Array.isArray(params.components) || params.components.length === 0) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'solve_vle_flash requires a non-empty components array');
        }
        if (
          params.components.some((component) => !component || typeof component !== 'object' || Array.isArray(component))
        ) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'solve_vle_flash requires explicit component property records; bundled component names are unavailable'
          );
        }
        requireFinite(['temperatureK', 'pressurePa', 'maxIter', 'tol'], jobRequest.operation);
        if (
          params.temperatureK <= 0 ||
          params.pressurePa <= 0 ||
          !Number.isSafeInteger(params.maxIter) ||
          params.maxIter < 1 ||
          params.tol <= 0
        ) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'solve_vle_flash requires positive temperature, pressure, iteration count, and tolerance'
          );
        }
        const composition = params.feedComposition ?? params.z;
        if (!Array.isArray(composition) || composition.length !== params.components.length) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'solve_vle_flash requires a feed composition matching the component count'
          );
        }
        if (
          composition.some((value) => !Number.isFinite(value) || value < 0) ||
          Math.abs(composition.reduce((sum, value) => sum + value, 0) - 1) > 1e-8
        ) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'Feed mole fractions must be finite, non-negative, and sum to one'
          );
        }
        break;
      }
      case 'calculate_nrtl_activity': {
        requireFields(['liquidComposition', 'temperatureK', 'delta_g', 'alpha'], jobRequest.operation);
        requireFinite(['temperatureK'], jobRequest.operation);
        if (!Array.isArray(params.liquidComposition) || params.liquidComposition.length < 2) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'calculate_nrtl_activity requires at least two explicit liquid mole fractions'
          );
        }
        break;
      }
      case 'calculate_water_hammer': {
        requireFields(
          ['fluidDensity', 'fluidBulkModulus', 'pipeElasticModulus', 'pipeWallThickness', 'restraintFactor'],
          jobRequest.operation
        );
        requireOneOf(['pipeDiameter', 'pipeInnerDiameter'], jobRequest.operation);
        requireOneOf(['steadyVelocity', 'steadyFlowRate'], jobRequest.operation);
        requireFields(['runMOC'], jobRequest.operation);
        if (typeof params.runMOC !== 'boolean') {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'calculate_water_hammer requires an explicit boolean runMOC choice'
          );
        }
        requireFinite(
          [
            'fluidDensity',
            'fluidBulkModulus',
            'pipeElasticModulus',
            'pipeWallThickness',
            'restraintFactor',
            ...(params.pipeDiameter !== undefined ? ['pipeDiameter'] : ['pipeInnerDiameter']),
            ...(params.steadyVelocity !== undefined ? ['steadyVelocity'] : ['steadyFlowRate'])
          ],
          jobRequest.operation
        );
        if (params.runMOC === true) {
          requireFields(
            [
              'pipeLength',
              'darcyFrictionFactor',
              'reservoirHead',
              'valveClosureTime',
              'valveClosureLaw',
              'simulationDuration',
              'reaches'
            ],
            jobRequest.operation
          );
        }
        break;
      }
      case 'generate_vle_envelope':
        requireFields(
          ['composition', 'pMinBar', 'pMaxBar', 'points', 'componentProperties', 'tMinC', 'tMaxC'],
          jobRequest.operation
        );
        break;
      default:
        break;
    }
    return true;
  }

  async execute(jobRequest, onEvent = () => {}, signal = null) {
    await this.validate(jobRequest);
    const tStart = Date.now();
    const jobId = jobRequest.jobId;

    onEvent(
      new JobEvent({ jobId, type: JobEventType.STARTED, message: `Starting plant operation "${jobRequest.operation}"` })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      let convergenceHistory = [];
      const warnings = [];
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'solve_vle_flash': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 25,
              message: 'Configuring Peng-Robinson EOS multicomponent flash'
            })
          );
          const components = params.components;
          const eos = new PengRobinsonEOS(components, params.k_ij);

          const T = params.temperatureK;
          const P = params.pressurePa;
          const z = params.feedComposition ?? params.z;

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 60,
              message: `Solving Rachford-Rice isothermal-isobaric flash at T=${T}K, P=${(P / 1e5).toFixed(1)}bar`
            })
          );
          const flash = eos.flashPT(z, T, P, { maxIter: params.maxIter, tol: params.tol });
          if (!flash.converged) {
            throw new OmniError(
              OmniErrorCode.NUMERICAL_FAILURE,
              'Peng-Robinson flash did not meet the requested convergence tolerance',
              { iterations: flash.iterations, residual: flash.residual, tolerance: params.tol }
            );
          }
          convergenceHistory = flash.convergenceHistory;
          warnings.push('Caller-supplied component property records are unverified engineering data.');

          outputData = {
            temperatureK: T,
            pressurePa: P,
            vaporFraction: Number(flash.beta.toFixed(5)),
            liquidComposition: Array.from(flash.x).map((v) => Number(v.toFixed(5))),
            vaporComposition: Array.from(flash.y).map((v) => Number(v.toFixed(5))),
            equilibriumConstantsK: Array.from(flash.K).map((v) => Number(v.toFixed(5))),
            compressibilityLiquid: Number(flash.Z_L.toFixed(4)),
            compressibilityVapor: Number(flash.Z_V.toFixed(4)),
            converged: flash.converged,
            phaseState: flash.phaseState,
            iterations: flash.iterations,
            residual: flash.residual,
            componentDataStatus: 'caller-supplied-unverified-property-records',
            componentProvenance: components.map(({ name, provenance }) => ({ name, provenance })),
            solverControls: { maxIter: params.maxIter, tolerance: params.tol }
          };
          break;
        }

        case 'calculate_nrtl_activity': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Calculating NRTL liquid activity coefficients'
            })
          );
          const x = params.liquidComposition;
          const T = params.temperatureK;
          const delta_g = params.delta_g;
          const alpha = params.alpha;

          const gamma = PengRobinsonEOS.calculateNRTL(x, T, delta_g, alpha);
          outputData = {
            temperatureK: T,
            liquidComposition: x,
            activityCoefficients: Array.from(gamma).map((v) => Number(v.toFixed(5)))
          };
          break;
        }

        case 'calculate_water_hammer': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Evaluating Korteweg wave speed and Joukowsky surge'
            })
          );
          const conduit = {
            fluidDensity: params.fluidDensity,
            fluidBulkModulus: params.fluidBulkModulus,
            pipeElasticModulus: params.pipeElasticModulus,
            pipeInnerDiameter: params.pipeDiameter ?? params.pipeInnerDiameter,
            pipeWallThickness: params.pipeWallThickness,
            restraintFactor: params.restraintFactor
          };

          const waveSpeed = TransientWaterHammerSolver.calculateWaveSpeed(conduit);
          const v0 =
            params.steadyVelocity !== undefined
              ? params.steadyVelocity
              : params.steadyFlowRate / (Math.PI * Math.pow(conduit.pipeInnerDiameter / 2, 2));
          const surge = TransientWaterHammerSolver.joukowskySurge(waveSpeed, v0, conduit.fluidDensity);

          let moc = null;
          if (params.runMOC) {
            onEvent(
              new JobEvent({
                jobId,
                type: JobEventType.PROGRESS,
                progressPercent: 65,
                message: 'Executing 1D Method of Characteristics transient solver'
              })
            );
            const mocParams = {
              pipeLength: params.pipeLength,
              pipeDiameter: conduit.pipeInnerDiameter,
              pipeWallThickness: conduit.pipeWallThickness,
              darcyFrictionFactor: params.darcyFrictionFactor,
              reservoirHead: params.reservoirHead,
              steadyFlowRate: params.steadyFlowRate ?? v0 * Math.PI * Math.pow(conduit.pipeInnerDiameter / 2, 2),
              valveClosureTime: params.valveClosureTime,
              valveClosureLaw: params.valveClosureLaw,
              simulationDuration: params.simulationDuration,
              reaches: params.reaches,
              fluidDensity: conduit.fluidDensity,
              fluidBulkModulus: conduit.fluidBulkModulus,
              pipeElasticModulus: conduit.pipeElasticModulus,
              restraintFactor: conduit.restraintFactor
            };
            moc = TransientWaterHammerSolver.solveTransientMOC(mocParams);
          }

          outputData = {
            waveSpeedMs: waveSpeed,
            steadyVelocityMs: Number(v0.toFixed(3)),
            joukowskySurgePressurePa: surge.surgePressurePa,
            joukowskySurgeHeadM: surge.surgeHeadM,
            mocSolution: moc
          };
          break;
        }

        case 'generate_vle_envelope': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Calculating multicomponent VLE P-T envelope'
            })
          );
          const composition = params.composition;
          const pMinBar = params.pMinBar;
          const pMaxBar = params.pMaxBar;
          const points = params.points;
          const componentProperties = params.componentProperties;
          const tMinC = params.tMinC;
          const tMaxC = params.tMaxC;
          outputData = VLEPhaseEnvelopeEngine.generatePTEnvelope(
            composition,
            pMinBar,
            pMaxBar,
            points,
            componentProperties,
            tMinC,
            tMaxC
          );
          break;
        }

        default:
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `Operation "${jobRequest.operation}" not implemented in PlantEngineAdapter`
          );
      }

      onEvent(
        new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'Plant operation complete' })
      );

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData,
        convergenceHistory,
        warnings,
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
  PlantEngineAdapter
};
