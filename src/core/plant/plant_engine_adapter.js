'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { PengRobinsonEOS } = require('./peng_robinson_eos');
const { NaphtaliSandholmColumnSolver } = require('./naphtali_sandholm_mesh');
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
        'solve_distillation_mesh',
        'calculate_water_hammer',
        'generate_vle_envelope'
      ],
      maturity: ValidationMaturity.EXPERIMENTAL,
      native: false
    };
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
          const components = params.components || ['methane', 'ethane', 'propane'];
          const eos = new PengRobinsonEOS(components, params.k_ij);

          const T = Number(params.temperatureK || 250.0);
          const P = Number(params.pressurePa || 3.0e6);
          const z = params.feedComposition || params.z || new Array(components.length).fill(1 / components.length);

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 60,
              message: `Solving Rachford-Rice isothermal-isobaric flash at T=${T}K, P=${(P / 1e5).toFixed(1)}bar`
            })
          );
          const flash = eos.flashPT(z, T, P, params.maxIter || 60, params.tol || 1e-6);

          outputData = {
            temperatureK: T,
            pressurePa: P,
            vaporFraction: Number(flash.beta.toFixed(5)),
            liquidComposition: Array.from(flash.x).map((v) => Number(v.toFixed(5))),
            vaporComposition: Array.from(flash.y).map((v) => Number(v.toFixed(5))),
            equilibriumConstantsK: Array.from(flash.K).map((v) => Number(v.toFixed(5))),
            compressibilityLiquid: Number(flash.Z_L.toFixed(4)),
            compressibilityVapor: Number(flash.Z_V.toFixed(4)),
            converged: flash.converged
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
          const x = params.liquidComposition || [0.5, 0.5];
          const T = Number(params.temperatureK || 298.15);
          const delta_g = params.delta_g || [
            [0, 2000],
            [1500, 0]
          ];
          const alpha = params.alpha || [
            [0, 0.3],
            [0.3, 0]
          ];

          const gamma = PengRobinsonEOS.calculateNRTL(x, T, delta_g, alpha);
          outputData = {
            temperatureK: T,
            liquidComposition: x,
            activityCoefficients: Array.from(gamma).map((v) => Number(v.toFixed(5)))
          };
          break;
        }

        case 'solve_distillation_mesh': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Formulating simultaneous MESH equations for column'
            })
          );
          outputData = NaphtaliSandholmColumnSolver.solve(params);
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
            fluidDensity: params.fluidDensity || 998.2,
            fluidBulkModulus: params.fluidBulkModulus || 2.19e9,
            pipeElasticModulus: params.pipeElasticModulus || 2.0e11,
            pipeInnerDiameter: params.pipeDiameter || params.pipeInnerDiameter || 0.3,
            pipeWallThickness: params.pipeWallThickness || 0.008,
            restraintFactor: params.restraintFactor || 1.0
          };

          const waveSpeed = TransientWaterHammerSolver.calculateWaveSpeed(conduit);
          const v0 =
            params.steadyVelocity ||
            (params.steadyFlowRate
              ? params.steadyFlowRate / (Math.PI * Math.pow(conduit.pipeInnerDiameter / 2, 2))
              : 2.0);
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
              pipeLength: params.pipeLength || 1000.0,
              pipeDiameter: conduit.pipeInnerDiameter,
              pipeWallThickness: conduit.pipeWallThickness,
              darcyFrictionFactor: params.darcyFrictionFactor || 0.018,
              reservoirHead: params.reservoirHead || 100.0,
              steadyFlowRate: params.steadyFlowRate || v0 * Math.PI * Math.pow(conduit.pipeInnerDiameter / 2, 2),
              valveClosureTime: params.valveClosureTime || 0.5,
              valveClosureLaw: params.valveClosureLaw || 'linear',
              simulationDuration: params.simulationDuration || 3.0,
              reaches: params.reaches || 20,
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
          const composition = params.composition || { methane: 0.7, ethane: 0.2, propane: 0.1 };
          const pMinBar = Number(params.pMinBar || 1.0);
          const pMaxBar = Number(params.pMaxBar || 50.0);
          const points = Number(params.points || 20);
          const componentProperties = params.componentProperties || {
            methane: {
              criticalTemperatureK: 190.56,
              criticalPressurePa: 45.99e5,
              molecularWeightKgPerMol: 0.01604,
              acentricFactor: 0.0115,
              provenance: { source: 'NIST Chemistry WebBook (SRD 69)', license: 'public-domain' }
            },
            ethane: {
              criticalTemperatureK: 305.32,
              criticalPressurePa: 48.72e5,
              molecularWeightKgPerMol: 0.03007,
              acentricFactor: 0.0995,
              provenance: { source: 'NIST Chemistry WebBook (SRD 69)', license: 'public-domain' }
            },
            propane: {
              criticalTemperatureK: 369.83,
              criticalPressurePa: 42.48e5,
              molecularWeightKgPerMol: 0.0441,
              acentricFactor: 0.1523,
              provenance: { source: 'NIST Chemistry WebBook (SRD 69)', license: 'public-domain' }
            }
          };
          outputData = VLEPhaseEnvelopeEngine.generatePTEnvelope(
            composition,
            pMinBar,
            pMaxBar,
            points,
            componentProperties
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
