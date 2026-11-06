'use strict';

const crypto = require('crypto');
const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { Quantity } = require('../contracts/Quantity');
const { ValidationRecord, ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { PengRobinsonEOS } = require('./peng_robinson_eos');
const { TransientWaterHammerSolver } = require('./transient_water_hammer');
const { NaphtaliSandholmColumnSolver } = require('./naphtali_sandholm_mesh');
const { VLEPhaseEnvelopeEngine } = require('./vle_envelope');
const { IAPWS_IF97 } = require('./iapws_if97');
const { WegsteinRecycleSolver } = require('./wegstein_recycle_solver');
const { PinchEnergyTargeter } = require('./pinch_energy_targeter');
const { DynamicFlowsheetSolver } = require('./dynamic_flowsheet_solver');
const { PetroleumAssayCharacterizer } = require('./petroleum_assay_characterizer');
const { ActivityCoefficientModels } = require('./activity_coefficient_models');

/**
 * PlantEngineAdapter: Standard EngineAdapter for Chemical Process Thermodynamics, VLE Flash, Distillation, Hydraulics, Pinch, and Dynamic Flowsheets
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
        'solve_distillation_column',
        'calculate_nrtl_activity',
        'calculate_water_hammer',
        'generate_vle_envelope',
        'calculate_steam_properties',
        'solve_recycle_loop',
        'calculate_pinch_targets',
        'simulate_dynamic_valve',
        'simulate_dynamic_blowdown',
        'characterize_petroleum_assay',
        'calculate_activity_coefficients'
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
      case 'solve_distillation_column': {
        requireFields(['stageCount', 'feedStage', 'components', 'refluxRatio', 'distillateRate'], jobRequest.operation);
        if (
          !Number.isInteger(params.stageCount) ||
          params.stageCount < 5 ||
          params.stageCount > 30 ||
          !Number.isInteger(params.feedStage) ||
          params.feedStage < 1 ||
          params.feedStage > params.stageCount
        ) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'solve_distillation_column requires stageCount in [5,30] and feedStage within the column'
          );
        }
        if (!Array.isArray(params.components) || params.components.length < 2 || params.components.length > 5) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'solve_distillation_column requires 2..5 component names');
        }
        requireOneOf(['feedComposition', 'feedFractions'], jobRequest.operation);
        requireFinite(['refluxRatio', 'distillateRate'], jobRequest.operation);
        if (params.refluxRatio <= 0 || !(params.distillateRate > 0 && params.distillateRate < 1)) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'solve_distillation_column requires positive refluxRatio and distillateRate in (0,1)'
          );
        }
        if (params.feedVaporFraction !== undefined) {
          requireFinite(['feedVaporFraction'], jobRequest.operation);
          if (!(params.feedVaporFraction >= 0 && params.feedVaporFraction <= 1)) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'solve_distillation_column requires feedVaporFraction in [0,1]'
            );
          }
        }
        if (params.pressurePa !== undefined && params.pressureProfilePa !== undefined) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'solve_distillation_column requires either pressurePa or pressureProfilePa, not both'
          );
        }
        if (params.pressurePa !== undefined) {
          requireFinite(['pressurePa'], jobRequest.operation);
          if (params.pressurePa <= 0) {
            throw new OmniError(OmniErrorCode.INVALID_INPUT, 'solve_distillation_column requires positive pressurePa');
          }
        } else if (params.pressureProfilePa !== undefined) {
          if (
            !Array.isArray(params.pressureProfilePa) ||
            params.pressureProfilePa.length !== params.stageCount ||
            params.pressureProfilePa.some((p) => !Number.isFinite(p) || p <= 0)
          ) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'solve_distillation_column requires a positive pressure per stage in pressureProfilePa'
            );
          }
        } else {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            'solve_distillation_column requires explicit pressurePa or pressureProfilePa'
          );
        }
        break;
      }
      case 'calculate_steam_properties':
        requireFields(['pressurePa', 'temperatureK'], jobRequest.operation);
        requireFinite(['pressurePa', 'temperatureK'], jobRequest.operation);
        break;
      case 'solve_recycle_loop':
        requireFields(['x0'], jobRequest.operation);
        if (!Array.isArray(params.x0) && !(params.x0 instanceof Float64Array)) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'solve_recycle_loop requires an x0 array or Float64Array');
        }
        break;
      case 'calculate_pinch_targets':
        requireFields(['streams'], jobRequest.operation);
        if (!Array.isArray(params.streams)) {
          throw new OmniError(OmniErrorCode.INVALID_INPUT, 'calculate_pinch_targets requires a streams array');
        }
        break;
      case 'simulate_dynamic_valve':
        requireFields(['pUpstream', 'pDownstream'], jobRequest.operation);
        requireFinite(['pUpstream', 'pDownstream'], jobRequest.operation);
        break;
      case 'simulate_dynamic_blowdown':
        requireFields(['vessel'], jobRequest.operation);
        break;
      case 'characterize_petroleum_assay': {
        const assayParams = params.options || params;
        const required = ['apiGravity', 'distillationType', 'distillationData', 'dataSource'];
        const missing = required.filter((field) => assayParams[field] === undefined || assayParams[field] === null);
        if (missing.length > 0) {
          throw new OmniError(
            OmniErrorCode.INVALID_INPUT,
            `characterize_petroleum_assay requires explicit inputs: ${missing.join(', ')}`
          );
        }
        break;
      }
      case 'calculate_activity_coefficients':
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

        case 'solve_distillation_column': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Solving equilibrium-stage distillation column MESH system'
            })
          );
          const result = NaphtaliSandholmColumnSolver.solve(params);
          if (!result.success) {
            throw new OmniError(OmniErrorCode.NUMERICAL_FAILURE, result.error.message, result.error.details || {});
          }
          convergenceHistory = result.convergence.history;
          warnings.push(...result.warnings);
          outputData = result;
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

        case 'calculate_steam_properties': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Evaluating IAPWS-IF97 steam and water thermodynamic formulation'
            })
          );
          const p = params.pressurePa;
          const t = params.temperatureK;
          outputData = IAPWS_IF97.calculateProperties(p, t);
          break;
        }

        case 'solve_recycle_loop': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Accelerating tear stream recycle loop convergence'
            })
          );
          const solver = new WegsteinRecycleSolver(params.config || {});
          if (typeof params.evalFlowsheet !== 'function') {
            const err = new Error(
              'solve_recycle_loop requires a caller-supplied evalFlowsheet function; refusing to fabricate a recycle model'
            );
            err.code = 'REQUIRED_EVALUATOR';
            throw err;
          }
          outputData = solver.solve(params.x0, params.evalFlowsheet);
          break;
        }

        case 'calculate_pinch_targets': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Synthesizing Linnhoff Pinch heat exchanger network targets'
            })
          );
          outputData = PinchEnergyTargeter.calculateTargets(
            params.streams || [],
            params.deltaTmin !== undefined ? params.deltaTmin : 10.0
          );
          break;
        }

        case 'simulate_dynamic_valve': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Evaluating control valve flow rate with trim characteristics'
            })
          );
          outputData = {
            massFlowKgS: DynamicFlowsheetSolver.evaluateControlValveFlow(
              params.valve || {},
              params.pUpstream,
              params.pDownstream,
              params.fluidDensity !== undefined ? params.fluidDensity : 1000.0
            )
          };
          break;
        }

        case 'simulate_dynamic_blowdown': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Simulating API 521 emergency blowdown vessel depressurization'
            })
          );
          const solver = new DynamicFlowsheetSolver({ dt: params.dt || 0.05 });
          outputData = solver.simulateSeparatorBlowdown(
            params.vessel || params,
            params.duration !== undefined ? params.duration : 600.0
          );
          break;
        }

        case 'characterize_petroleum_assay': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Characterizing crude assay distillation curve into pseudo-components'
            })
          );
          const assayParams = params.options || params;
          const assay = new PetroleumAssayCharacterizer(assayParams);
          outputData = assay.characterize(assayParams);
          break;
        }

        case 'calculate_activity_coefficients': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Evaluating liquid-phase activity coefficients and VLE bubble point'
            })
          );
          if (params.findAzeotrope) {
            outputData = ActivityCoefficientModels.findAzeotrope(
              params.comp1 || 'ethanol',
              params.comp2 || 'water',
              params.tempC !== undefined ? params.tempC : 78.15,
              params.interactionParams || {}
            );
          } else {
            outputData = ActivityCoefficientModels.evaluateNRTLBinary(
              params.x1 !== undefined ? params.x1 : 0.5,
              params.tempC !== undefined ? params.tempC : 60.0,
              params.interactionParams || {}
            );
          }
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

      const inputHash = crypto
        .createHash('sha256')
        .update(JSON.stringify({ operation: jobRequest.operation, parameters: params }))
        .digest('hex');

      const validationRecord = new ValidationRecord({
        maturity: ValidationMaturity.EXPERIMENTAL,
        benchmarkSet: `PLANT-${jobRequest.operation.toUpperCase()}-01`,
        errors: {
          warningCount: Array.isArray(warnings) ? warnings.length : 0
        },
        tolerances: { maxMassBalanceResidual: 1e-6 }
      });

      if (outputData && typeof outputData === 'object' && !Array.isArray(outputData)) {
        const quantities = {};
        if (Number.isFinite(outputData.vaporFraction)) {
          quantities.vaporFraction = Quantity.from(outputData.vaporFraction, '1').toJSON();
        }
        if (Number.isFinite(outputData.joukovskySurgeHeadM)) {
          quantities.joukovskySurgeHead = Quantity.from(outputData.joukovskySurgeHeadM, 'm').toJSON();
        }
        if (Number.isFinite(outputData.specificEnthalpyKJkg)) {
          quantities.specificEnthalpy = Quantity.from(outputData.specificEnthalpyKJkg, 'kJ').toJSON();
        }
        if (Number.isFinite(outputData.hotUtilityTargetKW)) {
          quantities.hotUtilityTarget = Quantity.from(outputData.hotUtilityTargetKW, 'kW').toJSON();
        }
        if (Number.isFinite(outputData.coldUtilityTargetKW)) {
          quantities.coldUtilityTarget = Quantity.from(outputData.coldUtilityTargetKW, 'kW').toJSON();
        }
        outputData.inputSha256 = inputHash;
        outputData.validationRecord = validationRecord.toJSON();
        outputData.quantities = quantities;
      }

      const outputHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(outputData || {}))
        .digest('hex');

      const durationMs = Date.now() - tStart;
      const result = new JobResult({
        jobId,
        status: JobStatus.SUCCEEDED,
        outputData,
        inputArtifactHashes: [inputHash],
        resultArtifactHashes: [outputHash],
        validationMaturity: ValidationMaturity.EXPERIMENTAL,
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
