'use strict';

const assert = require('assert');
const { OmniError, OmniErrorCode } = require('../src/core/contracts/OmniError');
const { EngineAdapter } = require('../src/core/contracts/EngineAdapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const { JobStatus } = require('../src/core/contracts/JobResult');
const { ValidationMaturity } = require('../src/core/contracts/ValidationRecord');
const {
  EngineRegistry,
  createDefaultEngineRegistry,
  defaultEngineRegistry
} = require('../src/core/contracts/engine_registry');
const { getGlobalPersistentWorkerPool } = require('../src/core/math/worker_pool');

// Adapters
const { OpticsEngineAdapter } = require('../src/core/optics/optics_engine_adapter');
const { PlantEngineAdapter } = require('../src/core/plant/plant_engine_adapter');
const { GeometryEngineAdapter, CSGMeshBooleans } = require('../src/core/cad/geometry_engine_adapter');
const { ControlsEngineAdapter } = require('../src/core/controls/controls_engine_adapter');
const { AerospaceEngineAdapter } = require('../src/core/aerospace/aerospace_engine_adapter');
const { HPCEngineAdapter } = require('../src/core/hpc/hpc_engine_adapter');
const { PDMEngineAdapter } = require('../src/core/pdm/pdm_engine_adapter');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { CAMEngineAdapter } = require('../src/core/cam/cam_engine_adapter');
const { FEAEngineAdapter } = require('../src/core/cae/fea_engine_adapter');
const { CFDEngineAdapter } = require('../src/core/cae/cfd_engine_adapter');
const { EDAEngineAdapter } = require('../src/core/eda/eda_engine_adapter');

// Specialized delegate engines for deep function coverage
const { FFT2D, DiffractionPSFMTFEngine } = require('../src/core/optics/diffraction_psf_mtf');
const { OpticalEngine } = require('../src/core/optics/optical_engine');
const { SeidelAberrations } = require('../src/core/optics/seidel_aberrations');
const { HeatExchangerTEMA } = require('../src/core/plant/heat_exchanger_tema');
const { PipingStressEngine } = require('../src/core/plant/piping_stress');
const { GeometryKernelAdapter, defaultGeometryKernel } = require('../src/core/cad/kernel_adapter');
const { PersistentNamingManager } = require('../src/core/cad/persistent_naming_manager');
const { FrequencyResponseAnalyzer } = require('../src/core/dynamic_simulink/frequency_analysis');
const { AutocoderCRust } = require('../src/core/dynamic_simulink/autocoder_c_rust');
const { ModernControlSynthesis } = require('../src/core/dynamic_simulink/multi_rate_scheduler');

// Test support data
const {
  getExperimentalPengRobinsonComponents,
  getExperimentalThermoProperties
} = require('./support/experimental_property_examples');

async function runEngineAdaptersCoverageTests() {
  console.log('================================================================');
  console.log('       RUNNING COMPREHENSIVE ENGINE ADAPTERS COVERAGE           ');
  console.log('================================================================\n');

  let passedTests = 0;
  let failedTests = 0;
  let currentSection = 'suite setup';

  try {
    // ---------------------------------------------------------------------------
    // 1. EngineAdapter (Base Contract & Abstract Class)
    // ---------------------------------------------------------------------------
    currentSection = '[1/13] EngineAdapter';
    console.log('[1/13] Testing EngineAdapter base contract & unimplemented methods...');
    {
      // Direct instantiation must throw TypeError
      assert.throws(
        () => new EngineAdapter('dummy', 'dummy-adapter'),
        TypeError,
        'Direct instantiation of EngineAdapter must throw TypeError'
      );

      // Bare subclass that does not override abstract methods
      class BareAdapter extends EngineAdapter {
        constructor() {
          super('mock_domain', 'bare-adapter', '1.0.0');
        }
      }

      const bare = new BareAdapter();
      const caps = bare.describeCapabilities();
      assert.strictEqual(caps.domain, 'mock_domain');
      assert.strictEqual(caps.name, 'bare-adapter');
      assert.strictEqual(caps.version, '1.0.0');
      assert.deepStrictEqual(caps.supportedOperations, []);
      assert.strictEqual(caps.maturity, ValidationMaturity.EXPERIMENTAL);
      assert.strictEqual(caps.native, false);

      // validate() with null request
      await assert.rejects(
        bare.validate(null),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'validate(null) must throw INVALID_INPUT'
      );

      // validate() with domain mismatch
      await assert.rejects(
        bare.validate(new JobRequest({ domain: 'other_domain', operation: 'op1' })),
        (err) => err.code === OmniErrorCode.UNSUPPORTED && err.message.includes('Domain mismatch'),
        'validate() with domain mismatch must throw UNSUPPORTED'
      );

      // validate() with unsupported operation
      await assert.rejects(
        bare.validate(new JobRequest({ domain: 'mock_domain', operation: 'op1' })),
        (err) => err.code === OmniErrorCode.UNSUPPORTED && err.message.includes('not supported'),
        'validate() with unsupported operation must throw UNSUPPORTED'
      );

      // execute() throws unimplemented UNSUPPORTED
      await assert.rejects(
        bare.execute(new JobRequest({ domain: 'mock_domain', operation: 'op1' })),
        (err) => err.code === OmniErrorCode.UNSUPPORTED && err.message.includes('not implemented'),
        'bare.execute() must throw UNSUPPORTED not implemented'
      );

      // cancel() returns false
      const cancelRes = await bare.cancel('job-999');
      assert.strictEqual(cancelRes, false);

      // checkpoint() returns null
      const cpRes = await bare.checkpoint('job-999');
      assert.strictEqual(cpRes, null);

      // Subclass providing supported operations to test prepare()
      class SupportedBareAdapter extends EngineAdapter {
        constructor() {
          super('mock_domain', 'supported-bare', '1.0.0');
        }
        describeCapabilities() {
          return {
            ...super.describeCapabilities(),
            supportedOperations: ['op_ok']
          };
        }
      }
      const supportedBare = new SupportedBareAdapter();
      const validReq = new JobRequest({ domain: 'mock_domain', operation: 'op_ok' });
      const validated = await supportedBare.validate(validReq);
      assert.strictEqual(validated, true);
      const prepared = await supportedBare.prepare(validReq);
      assert.deepStrictEqual(prepared, {});

      passedTests++;
      console.log('  ✓ PASSED: EngineAdapter abstract checks, validation errors & default implementations\n');
    }

    // ---------------------------------------------------------------------------
    // 2. OpticsEngineAdapter (Optics & Ray Tracing)
    // ---------------------------------------------------------------------------
    currentSection = '[2/13] OpticsEngineAdapter';
    console.log('[2/13] Testing OpticsEngineAdapter...');
    {
      const adapter = new OpticsEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'optics');
      assert.strictEqual(caps.name, 'optics-raytracing-engine-adapter');
      assert(caps.supportedOperations.includes('trace_skew_rays'));
      assert(caps.supportedOperations.includes('generate_pupil_rays'));
      assert(caps.supportedOperations.includes('calculate_refractive_index'));
      assert(caps.supportedOperations.includes('trace_polarization'));
      assert(caps.supportedOperations.includes('run_optical_tolerancing'));
      assert(caps.supportedOperations.includes('trace_non_sequential'));
      assert(caps.supportedOperations.includes('evaluate_volume_scattering'));
      assert(caps.supportedOperations.includes('evaluate_thermal_soak'));

      const singletSurfaces = [
        {
          radius: 50.0,
          zVertex: 0.0,
          clearRadius: 15.0,
          nIncident: 1.0,
          nTransmitted: 1.5168,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        },
        {
          radius: -50.0,
          zVertex: 5.0,
          clearRadius: 15.0,
          nIncident: 1.5168,
          nTransmitted: 1.0,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        }
      ];

      // A. trace_skew_rays with explicit rays
      const traceExplicitReq = new JobRequest({
        domain: 'optics',
        operation: 'trace_skew_rays',
        parameters: {
          surfaces: singletSurfaces,
          rays: [
            { origin: [0, 0, -10], direction: [0, 0, 1], wavelengthUm: 0.55, intensity: 1.0 },
            { origin: [1, 1, -10], direction: [0, 0, 1], wavelengthUm: 0.55, intensity: 1.0 }
          ],
          sensorZ: 60.0
        }
      });
      const traceExplicitRes = await adapter.execute(traceExplicitReq);
      assert.strictEqual(traceExplicitRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(traceExplicitRes.outputData.totalRays, 2);

      // B. trace_skew_rays with generated pupil rays
      const tracePupilReq = new JobRequest({
        domain: 'optics',
        operation: 'trace_skew_rays',
        parameters: {
          surfaces: singletSurfaces,
          pupilRadiusMm: 6.0,
          pupilPlaneZMm: -10.0,
          numRings: 2,
          raysPerRing: 4,
          fieldAngleDeg: 2.0,
          wavelengthUm: 0.58756,
          sensorZ: 55.0
        }
      });
      const tracePupilRes = await adapter.execute(tracePupilReq);
      assert.strictEqual(tracePupilRes.status, JobStatus.SUCCEEDED);
      assert(tracePupilRes.outputData.totalRays > 0);

      // C. generate_pupil_rays
      const pupilRaysReq = new JobRequest({
        domain: 'optics',
        operation: 'generate_pupil_rays',
        parameters: {
          pupilRadiusMm: 5.0,
          pupilPlaneZMm: 0.0,
          numRings: 2,
          raysPerRing: 4,
          fieldAngleDeg: 0.0,
          wavelengthUm: 0.55
        }
      });
      const pupilRaysRes = await adapter.execute(pupilRaysReq);
      assert.strictEqual(pupilRaysRes.status, JobStatus.SUCCEEDED);
      assert(pupilRaysRes.outputData.rayCount > 0);

      // D. calculate_refractive_index with custom Sellmeier
      const customSellmeier = {
        name: 'N-BK7',
        formula: 'sellmeier1',
        referenceTemperatureC: 20.0,
        B: [1.03961212, 0.231792344, 1.01046945],
        C: [0.00600069867, 0.0200179144, 103.560653],
        dndTPerK: 3e-6
      };
      const indexCustomReq = new JobRequest({
        domain: 'optics',
        operation: 'calculate_refractive_index',
        parameters: {
          customGlassRecord: customSellmeier,
          wavelengthUm: 0.58756,
          temperatureC: 25.0
        }
      });
      const indexCustomRes = await adapter.execute(indexCustomReq);
      assert.strictEqual(indexCustomRes.status, JobStatus.SUCCEEDED);
      assert(Math.abs(indexCustomRes.outputData.refractiveIndex - 1.5168) < 0.01);

      // Negative check: unbundled glass throws UNSUPPORTED
      await assert.rejects(
        adapter.execute(
          new JobRequest({
            domain: 'optics',
            operation: 'calculate_refractive_index',
            parameters: { glass: 'UnbundledGlass', wavelengthUm: 0.55, temperatureC: 20.0 }
          })
        ),
        (err) => err.code === OmniErrorCode.UNSUPPORTED
      );

      // E. trace_polarization: crystal splitting
      const polCrystalReq = new JobRequest({
        domain: 'optics',
        operation: 'trace_polarization',
        parameters: {
          crystal: { no: 1.5, ne: 1.6, opticAxis: [0, 0, 1] },
          rayDirection: [0, 0.1, 0.99],
          surfaceNormal: [0, 0, 1]
        }
      });
      const polCrystalRes = await adapter.execute(polCrystalReq);
      assert.strictEqual(polCrystalRes.status, JobStatus.SUCCEEDED);

      // F. trace_polarization: Fresnel transmission/reflection
      const polFresnelReq = new JobRequest({
        domain: 'optics',
        operation: 'trace_polarization',
        parameters: {
          fresnel: { n1: 1.0, n2: 1.5, thetaI: 0.4 }
        }
      });
      const polFresnelRes = await adapter.execute(polFresnelReq);
      assert.strictEqual(polFresnelRes.status, JobStatus.SUCCEEDED);

      // G. trace_polarization: Jones vector propagation
      const polJonesReq = new JobRequest({
        domain: 'optics',
        operation: 'trace_polarization',
        parameters: {
          Ex: 1.0,
          ExImag: 0.0,
          Ey: 0.0,
          EyImag: 0.0,
          elements: [
            { type: 'linear_polarizer', angleDeg: 45.0 },
            { type: 'rotator', angleDeg: 30.0 }
          ]
        }
      });
      const polJonesRes = await adapter.execute(polJonesReq);
      assert.strictEqual(polJonesRes.status, JobStatus.SUCCEEDED);
      assert(polJonesRes.outputData.intensity > 0);

      // H. run_optical_tolerancing
      const tolReq = new JobRequest({
        domain: 'optics',
        operation: 'run_optical_tolerancing',
        parameters: {
          nominalSystem: { surfaces: singletSurfaces },
          toleranceDefs: [{ type: 'radius', surfaceIndex: 0, delta: 0.05 }],
          options: { mcRuns: 4 }
        }
      });
      const tolRes = await adapter.execute(tolReq);
      assert.strictEqual(tolRes.status, JobStatus.SUCCEEDED);

      // I. trace_non_sequential
      const nonSeqReq = new JobRequest({
        domain: 'optics',
        operation: 'trace_non_sequential',
        parameters: {
          initialRay: { origin: [0, 0, 0], dir: [0, 0, 1], energy: 1.0, wavelengthNm: 550 },
          surfaces: [{ z: 10, radius: 15, n1: 1.0, n2: 1.5 }],
          options: { maxBounces: 2 }
        }
      });
      const nonSeqRes = await adapter.execute(nonSeqReq);
      assert.strictEqual(nonSeqRes.status, JobStatus.SUCCEEDED);

      // J. evaluate_volume_scattering (Beer-Lambert & Henyey-Greenstein)
      const scatterBeerReq = new JobRequest({
        domain: 'optics',
        operation: 'evaluate_volume_scattering',
        parameters: { type: 'beer_lambert', alphaAbsorptionMm: 0.02, distanceMm: 20.0, I0: 1.0 }
      });
      const scatterBeerRes = await adapter.execute(scatterBeerReq);
      assert.strictEqual(scatterBeerRes.status, JobStatus.SUCCEEDED);
      assert(scatterBeerRes.outputData.transmittedIntensity < 1.0);

      const scatterHgReq = new JobRequest({
        domain: 'optics',
        operation: 'evaluate_volume_scattering',
        parameters: { g: 0.75, xi: 0.4 }
      });
      const scatterHgRes = await adapter.execute(scatterHgReq);
      assert.strictEqual(scatterHgRes.status, JobStatus.SUCCEEDED);

      // K. evaluate_thermal_soak
      const soakReq = new JobRequest({
        domain: 'optics',
        operation: 'evaluate_thermal_soak',
        parameters: {
          lensSpec: {
            surfaces: [
              { radius: 50.0, thickness: 5.0, glass: 'N-BK7', cte: 7.1e-6, dndT: 3e-6 },
              { radius: -50.0, thickness: 50.0, glass: 'air' }
            ]
          },
          targetTempC: 45.0,
          refTempC: 20.0
        }
      });
      const soakRes = await adapter.execute(soakReq);
      assert.strictEqual(soakRes.status, JobStatus.SUCCEEDED);

      // L. Validation error branches
      await assert.rejects(
        adapter.execute(
          new JobRequest({ domain: 'optics', operation: 'trace_skew_rays', parameters: { surfaces: [] } })
        ),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'Empty surfaces must throw INVALID_INPUT'
      );

      await assert.rejects(
        adapter.execute(
          new JobRequest({
            domain: 'optics',
            operation: 'trace_polarization',
            parameters: { Ex: 1, ExImag: 0, Ey: 0, EyImag: 0, elements: [{ type: 'invalid_type', angleDeg: 0 }] }
          })
        ),
        (err) => err.code === OmniErrorCode.UNSUPPORTED,
        'Unsupported polarization element must throw UNSUPPORTED'
      );

      // Cancellation check
      const abortCtrl = new AbortController();
      abortCtrl.abort();
      await assert.rejects(
        adapter.execute(pupilRaysReq, () => {}, abortCtrl.signal),
        (err) => err.code === OmniErrorCode.CANCELLED,
        'Pre-aborted signal must throw CANCELLED'
      );

      // M. Additional Optics Delegates: FFT2D, DiffractionPSFMTFEngine, SeidelAberrations & OpticalEngine
      const psfRes = DiffractionPSFMTFEngine.evaluateWavefrontPSFandMTF({
        gridSize: 32,
        wavelengthUm: 0.55,
        fNumber: 2.8,
        defocusWaves: 0.25,
        sphericalWaves: 0.1
      });
      assert.strictEqual(typeof psfRes.airyRadiusUm, 'number');
      assert(psfRes.mtfCurve.length > 0);

      const testReal = new Float64Array([1, 0, 1, 0]);
      const testImag = new Float64Array([0, 0, 0, 0]);
      FFT2D.transform1D(testReal, testImag, false);
      FFT2D.transform1D(testReal, testImag, true);
      assert(Math.abs(testReal[0] - 1) < 1e-6);

      const rx = {
        focalLengthMm: 50.0,
        objectSpaceMaterial: 1.0,
        gapMaterial: 1.0,
        imageSpaceMaterial: 1.0,
        elements: [
          {
            id: 'E1',
            radiusFrontMm: 50.0,
            radiusRearMm: -50.0,
            centerThicknessMm: 5.0,
            clearApertureMm: 20.0,
            zPosMm: 0.0,
            conicFront: 0.0,
            conicRear: 0.0,
            asphericCoeffsFront: [0, 0, 0, 0],
            asphericCoeffsRear: [0, 0, 0, 0],
            opticalMaterial: { nd: 1.5168, nF: 1.5224, nC: 1.5143 }
          }
        ]
      };
      const seidel = OpticalEngine.computeSeidelAberrations(rx, { entrancePupilRadiusMm: 8.0, fieldAngleDeg: 3.0 });
      assert(seidel !== null);
      const metrics = OpticalEngine.solveOpticalMetrics(50.0, 2.8, 3.0, 550, 0.03);
      assert.strictEqual(typeof metrics.numericalAperture, 'number');

      passedTests++;
      console.log('  ✓ PASSED: OpticsEngineAdapter all 8 operations, validations, PSF/MTF & Seidel covered\n');
    }

    // ---------------------------------------------------------------------------
    // 3. PlantEngineAdapter (Chemical Process Thermodynamics & Piping)
    // ---------------------------------------------------------------------------
    currentSection = '[3/13] PlantEngineAdapter';
    console.log('[3/13] Testing PlantEngineAdapter...');
    {
      const adapter = new PlantEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'plant');
      assert.strictEqual(caps.supportedOperations.length, 12);

      // A. solve_vle_flash
      const comps = getExperimentalPengRobinsonComponents(['Methane', 'Ethane', 'Propane']);
      const flashReq = new JobRequest({
        domain: 'plant',
        operation: 'solve_vle_flash',
        parameters: {
          components: comps,
          k_ij: [
            [0, 0, 0],
            [0, 0, 0],
            [0, 0, 0]
          ],
          feedComposition: [0.3, 0.4, 0.3],
          temperatureK: 240.0,
          pressurePa: 3.5e6,
          maxIter: 60,
          tol: 1e-6
        }
      });
      const flashRes = await adapter.execute(flashReq);
      assert.strictEqual(flashRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(flashRes.outputData.converged, true);

      // B. calculate_nrtl_activity
      const nrtlReq = new JobRequest({
        domain: 'plant',
        operation: 'calculate_nrtl_activity',
        parameters: {
          liquidComposition: [0.4, 0.6],
          temperatureK: 323.15,
          delta_g: [
            [0.0, 2500.0],
            [1800.0, 0.0]
          ],
          alpha: [
            [0.0, 0.3],
            [0.3, 0.0]
          ]
        }
      });
      const nrtlRes = await adapter.execute(nrtlReq);
      assert.strictEqual(nrtlRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(nrtlRes.outputData.activityCoefficients.length, 2);

      // C. calculate_water_hammer (steady & MOC transient)
      const whSteadyReq = new JobRequest({
        domain: 'plant',
        operation: 'calculate_water_hammer',
        parameters: {
          fluidDensity: 998.2,
          fluidBulkModulus: 2.19e9,
          pipeElasticModulus: 2.0e11,
          pipeDiameter: 0.3,
          pipeWallThickness: 0.008,
          restraintFactor: 1.0,
          steadyVelocity: 2.5,
          runMOC: false
        }
      });
      const whSteadyRes = await adapter.execute(whSteadyReq);
      assert.strictEqual(whSteadyRes.status, JobStatus.SUCCEEDED);
      assert(whSteadyRes.outputData.waveSpeedMs > 0);

      const whMocReq = new JobRequest({
        domain: 'plant',
        operation: 'calculate_water_hammer',
        parameters: {
          fluidDensity: 998.2,
          fluidBulkModulus: 2.19e9,
          pipeElasticModulus: 2.0e11,
          pipeDiameter: 0.3,
          pipeWallThickness: 0.008,
          restraintFactor: 1.0,
          steadyVelocity: 2.5,
          runMOC: true,
          pipeLength: 200,
          darcyFrictionFactor: 0.02,
          reservoirHead: 50,
          valveClosureTime: 1.5,
          valveClosureLaw: 'linear',
          simulationDuration: 3.0,
          reaches: 4
        }
      });
      const whMocRes = await adapter.execute(whMocReq);
      assert.strictEqual(whMocRes.status, JobStatus.SUCCEEDED);
      assert(whMocRes.outputData.mocSolution !== null);

      // D. generate_vle_envelope
      const envReq = new JobRequest({
        domain: 'plant',
        operation: 'generate_vle_envelope',
        parameters: {
          composition: { Methane: 0.8, Ethane: 0.2 },
          pMinBar: 2.0,
          pMaxBar: 25.0,
          points: 4,
          componentProperties: getExperimentalThermoProperties(['Methane', 'Ethane']),
          tMinC: -40,
          tMaxC: 100
        }
      });
      const envRes = await adapter.execute(envReq);
      assert.strictEqual(envRes.status, JobStatus.SUCCEEDED);

      // E. calculate_steam_properties
      const steamReq = new JobRequest({
        domain: 'plant',
        operation: 'calculate_steam_properties',
        parameters: {
          pressurePa: 101325,
          temperatureK: 373.15
        }
      });
      const steamRes = await adapter.execute(steamReq);
      assert.strictEqual(steamRes.status, JobStatus.SUCCEEDED);
      assert(steamRes.outputData.specificEnthalpy_J_kg !== undefined);

      // F. solve_recycle_loop
      const recycleReq = {
        jobId: 'plant-recycle-coverage',
        domain: 'plant',
        operation: 'solve_recycle_loop',
        parameters: {
          x0: [10.0, 20.0],
          evalFlowsheet: (x) => Array.from(x).map((v) => (v + 1) / 2)
        }
      };
      const recycleRes = await adapter.execute(recycleReq);
      assert.strictEqual(recycleRes.status, JobStatus.SUCCEEDED);
      await assert.rejects(
        adapter.execute({
          jobId: 'plant-recycle-no-eval',
          domain: 'plant',
          operation: 'solve_recycle_loop',
          parameters: { x0: [1.0] }
        }),
        (err) => err.code === 'REQUIRED_EVALUATOR',
        'solve_recycle_loop must reject a missing evaluator'
      );

      // G. calculate_pinch_targets
      const pinchReq = new JobRequest({
        domain: 'plant',
        operation: 'calculate_pinch_targets',
        parameters: {
          streams: [
            { id: 'H1', type: 'hot', Tin: 160, Tout: 80, mCp: 12.0 },
            { id: 'C1', type: 'cold', Tin: 30, Tout: 120, mCp: 15.0 }
          ],
          deltaTmin: 10.0
        }
      });
      const pinchRes = await adapter.execute(pinchReq);
      assert.strictEqual(pinchRes.status, JobStatus.SUCCEEDED);
      assert(pinchRes.outputData.QHminKW !== undefined);

      // H. simulate_dynamic_valve
      const valveReq = new JobRequest({
        domain: 'plant',
        operation: 'simulate_dynamic_valve',
        parameters: {
          valve: { Cv: 60.0, position: 0.8, trim: 'equal_percentage' },
          pUpstream: 6e5,
          pDownstream: 2e5,
          fluidDensity: 1000.0
        }
      });
      const valveRes = await adapter.execute(valveReq);
      assert.strictEqual(valveRes.status, JobStatus.SUCCEEDED);
      assert(valveRes.outputData.massFlowKgS > 0);

      // I. simulate_dynamic_blowdown
      const blowdownReq = new JobRequest({
        domain: 'plant',
        operation: 'simulate_dynamic_blowdown',
        parameters: {
          vessel: {
            totalVolume: 5.0,
            initialPressure: 4e6,
            initialLiquidVolume: 1.0,
            temperatureK: 310.0,
            reliefOrificeDiameterMm: 25.0
          },
          duration: 30.0,
          dt: 1.0
        }
      });
      const blowdownRes = await adapter.execute(blowdownReq);
      assert.strictEqual(blowdownRes.status, JobStatus.SUCCEEDED);

      // J. characterize_petroleum_assay
      const assayReq = new JobRequest({
        domain: 'plant',
        operation: 'characterize_petroleum_assay',
        parameters: {
          options: {
            apiGravity: 34,
            distillationType: 'TBP',
            dataSource: 'test-only synthetic curve; not validated',
            distillationData: [
              { percent: 0, tempC: 35 },
              { percent: 10, tempC: 95 },
              { percent: 30, tempC: 175 },
              { percent: 50, tempC: 260 },
              { percent: 70, tempC: 360 },
              { percent: 90, tempC: 490 },
              { percent: 100, tempC: 620 }
            ]
          }
        }
      });
      const missingAssayInputsReq = new JobRequest({
        domain: 'plant',
        operation: 'characterize_petroleum_assay',
        parameters: { options: {} }
      });
      await assert.rejects(() => adapter.execute(missingAssayInputsReq), /requires explicit inputs/);
      const assayRes = await adapter.execute(assayReq);
      assert.strictEqual(assayRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(assayRes.outputData.dataStatus, 'caller-supplied-unverified');

      // K. calculate_activity_coefficients (binary & azeotrope)
      const actBinaryReq = new JobRequest({
        domain: 'plant',
        operation: 'calculate_activity_coefficients',
        parameters: { x1: 0.45, tempC: 65.0, interactionParams: {} }
      });
      const actBinaryRes = await adapter.execute(actBinaryReq);
      assert.strictEqual(actBinaryRes.status, JobStatus.SUCCEEDED);

      const actAzeoReq = new JobRequest({
        domain: 'plant',
        operation: 'calculate_activity_coefficients',
        parameters: { findAzeotrope: true, comp1: 'ethanol', comp2: 'water', tempC: 78.15 }
      });
      const actAzeoRes = await adapter.execute(actAzeoReq);
      assert.strictEqual(actAzeoRes.status, JobStatus.SUCCEEDED);

      // L. Validation error branches
      await assert.rejects(
        adapter.execute(new JobRequest({ domain: 'plant', operation: 'calculate_water_hammer', parameters: {} })),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'Missing water hammer inputs must throw INVALID_INPUT'
      );

      // M. Additional Plant Delegates: HeatExchangerTEMA & PipingStressEngine
      const hotStream = { massFlowKgS: 8.0, CpJkgK: 2100.0, TinC: 130.0, ToutC: 70.0 };
      const coldStream = { massFlowKgS: 15.0, CpJkgK: 4184.0, TinC: 25.0, ToutC: 55.0 };
      const hxResult = HeatExchangerTEMA.rateExchanger(hotStream, coldStream, {
        tubeOD_mm: 19.05,
        tubeLength_m: 6.0,
        overallU_W_m2K: 500.0
      });
      assert(hxResult.dutyKW > 0);

      const pipingResult = PipingStressEngine.evaluateASMEB313({
        pipeOuterDiameterMm: 219.1,
        nominalWallThicknessMm: 8.18,
        youngsModulusGPa: 200.0,
        thermalExpansionPerK: 1.2e-5,
        designPressureBar: 25.0,
        operatingTempC: 160.0,
        ambientTempC: 20.0,
        straightLengthM: 40.0,
        hasExpansionLoop: false,
        corrosionAllowanceMm: 1.5
      });
      assert.strictEqual(pipingResult.status, 'estimate');
      assert(pipingResult.hoopStress_MPa > 0);

      passedTests++;
      console.log('  ✓ PASSED: PlantEngineAdapter all 11 operations, validations, heat exchanger & piping covered\n');
    }

    // ---------------------------------------------------------------------------
    // 4. GeometryEngineAdapter (CAD Kernel & CSG Booleans)
    // ---------------------------------------------------------------------------
    currentSection = '[4/13] GeometryEngineAdapter';
    console.log('[4/13] Testing GeometryEngineAdapter...');
    {
      const adapter = new GeometryEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'cad');
      assert.strictEqual(caps.supportedOperations.length, 9);

      // A. evaluate_nurbs
      const nurbsReq = new JobRequest({
        domain: 'cad',
        operation: 'evaluate_nurbs',
        parameters: {
          surface: {
            controlPoints: [
              [
                [0, 0, 0],
                [10, 0, 2],
                [20, 0, 0]
              ],
              [
                [0, 10, 2],
                [10, 10, 6],
                [20, 10, 2]
              ],
              [
                [0, 20, 0],
                [10, 20, 2],
                [20, 20, 0]
              ]
            ],
            degreeU: 2,
            degreeV: 2
          },
          u: 0.5,
          v: 0.5
        }
      });
      const nurbsRes = await adapter.execute(nurbsReq);
      assert.strictEqual(nurbsRes.status, JobStatus.SUCCEEDED);
      assert(nurbsRes.outputData.point !== undefined);

      // B. intersect_nurbs_ssi
      const ssiReq = new JobRequest({
        domain: 'cad',
        operation: 'intersect_nurbs_ssi',
        parameters: {
          surfA: {
            controlPoints: [
              [
                [0, 0, 0],
                [10, 0, 0]
              ],
              [
                [0, 10, 0],
                [10, 10, 0]
              ]
            ],
            degreeU: 1,
            degreeV: 1
          },
          surfB: {
            controlPoints: [
              [
                [5, -5, -5],
                [5, 15, -5]
              ],
              [
                [5, -5, 5],
                [5, 15, 5]
              ]
            ],
            degreeU: 1,
            degreeV: 1
          }
        }
      });
      const ssiRes = await adapter.execute(ssiReq);
      assert.strictEqual(ssiRes.status, JobStatus.SUCCEEDED);

      // C. apply_edge_blend
      const { BRepPrimitives } = require('../src/core/cad/brep_topology');
      const blendSolid = BRepPrimitives.createBox(20, 20, 20);
      blendSolid.buildEdges();
      const targetEdge = blendSolid.edges[0];

      const blendReq = new JobRequest({
        domain: 'cad',
        operation: 'apply_edge_blend',
        parameters: {
          solid: blendSolid,
          targetEdge: targetEdge,
          radius: 2.0,
          lengthUnit: 'mm'
        }
      });
      const blendRes = await adapter.execute(blendReq);
      assert.strictEqual(blendRes.status, JobStatus.SUCCEEDED);

      // D. solve_assembly_mates
      const mateReq = new JobRequest({
        domain: 'cad',
        operation: 'solve_assembly_mates',
        parameters: {
          components: [
            { id: 'base', name: 'BasePart', fixed: true },
            { id: 'plate', name: 'PlatePart', position: [0, 0, 5] }
          ],
          mates: [
            {
              type: 'COINCIDENT',
              compA: 'base',
              ptA: [0, 0, 0],
              normA: [0, 0, 1],
              compB: 'plate',
              ptB: [0, 0, 0],
              normB: [0, 0, -1]
            }
          ],
          lengthUnit: 'mm'
        }
      });
      const mateRes = await adapter.execute(mateReq);
      assert.strictEqual(mateRes.status, JobStatus.SUCCEEDED);

      // E. export_step
      const stepReq = new JobRequest({
        domain: 'cad',
        operation: 'export_step',
        parameters: {
          solid: blendSolid,
          modelName: 'TestBlock'
        }
      });
      const stepRes = await adapter.execute(stepReq);
      assert.strictEqual(stepRes.status, JobStatus.SUCCEEDED);
      assert(stepRes.outputData.sizeBytes > 0);

      // F. solve_variational_sketch
      const sketchReq = new JobRequest({
        domain: 'cad',
        operation: 'solve_variational_sketch',
        parameters: {
          points: [
            { id: 'p0', x: 0, y: 0, fixed: true },
            { id: 'p1', x: 5, y: 1 }
          ],
          constraints: [
            { type: 'HORIZONTAL', p1: 'p0', p2: 'p1' },
            { type: 'DISTANCE_POINTS', p1: 'p0', p2: 'p1', distance: 10.0 }
          ]
        }
      });
      const sketchRes = await adapter.execute(sketchReq);
      assert.strictEqual(sketchRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(sketchRes.outputData.converged, true);

      // G. boolean_union, boolean_subtract, boolean_intersect with primitives
      const boxA = { type: 'box', size: [10, 10, 10], center: [0, 0, 0] };
      const boxB = { type: 'box', size: [6, 6, 6], center: [5, 0, 0] };
      const cyl = { type: 'cylinder', radius: 3, height: 12, center: [0, 0, 0], segments: 32 };

      const unionReq = new JobRequest({
        domain: 'cad',
        operation: 'boolean_union',
        parameters: { solidA: boxA, solidB: boxB, lengthUnit: 'mm' }
      });
      const unionRes = await adapter.execute(unionReq);
      assert.strictEqual(unionRes.status, JobStatus.SUCCEEDED);
      assert(unionRes.outputData.volumeValue > 0);

      const subReq = new JobRequest({
        domain: 'cad',
        operation: 'boolean_subtract',
        parameters: { solidA: boxA, solidB: cyl, lengthUnit: 'm' }
      });
      const subRes = await adapter.execute(subReq);
      assert.strictEqual(subRes.status, JobStatus.SUCCEEDED);

      const interReq = new JobRequest({
        domain: 'cad',
        operation: 'boolean_intersect',
        parameters: { solidA: boxA, solidB: boxB, lengthUnit: 'mm' }
      });
      const interRes = await adapter.execute(interReq);
      assert.strictEqual(interRes.status, JobStatus.SUCCEEDED);

      // H. Validation errors
      await assert.rejects(
        adapter.execute(new JobRequest({ domain: 'cad', operation: 'boolean_union', parameters: { solidA: boxA } })),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'Missing solidB in boolean operation must throw INVALID_INPUT'
      );
      await assert.rejects(
        adapter.execute(
          new JobRequest({ domain: 'cad', operation: 'boolean_union', parameters: { solidA: boxA, solidB: boxB } })
        ),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'Boolean operations without a declared length unit must throw INVALID_INPUT'
      );
      await assert.rejects(
        adapter.execute(
          new JobRequest({
            domain: 'cad',
            operation: 'solve_assembly_mates',
            parameters: {
              components: [{ id: 'base' }, { id: 'plate' }],
              mates: [{ type: 'COINCIDENT', compA: 'base', compB: 'plate' }],
              lengthUnit: 'mm'
            }
          })
        ),
        TypeError,
        'Assembly mates without explicit reference points and directions must be rejected'
      );

      // I. Additional CAD Delegates: GeometryKernelAdapter & PersistentNamingManager
      const kernel = new GeometryKernelAdapter();
      const kBox = kernel.makeBox(15, 10, 5, 'BaseBox');
      const kCyl = kernel.makeCylinder(3, 8, 'HoleCyl');
      const cutSolid = kernel.booleanCut(kBox, kCyl, 'CutFeature');
      assert(cutSolid !== null);
      const fusedSolid = kernel.booleanFuse(kBox, kCyl, 'FuseFeature');
      assert(fusedSolid !== null);
      const valProps = kernel.computeValidationProperties(kBox);
      assert(valProps.volume > 0);
      const kernelInfo = kernel.getKernelInfo();
      assert.strictEqual(kernelInfo.activeBackend, 'legacy-mesh-brep');

      const pnm = new PersistentNamingManager();
      const tag = pnm.generateTag('Extrude1', 'FACE', 0, { normal: { x: 0, y: 0, z: 1 } });
      assert(typeof tag === 'string');
      pnm.recordMutation('Cut1', [{ parentTag: tag, action: 'MODIFY' }]);
      pnm.recordMutation('Delete1', [{ parentTag: tag, action: 'DELETE' }]);

      passedTests++;
      console.log(
        '  ✓ PASSED: GeometryEngineAdapter all 9 operations, CSG booleans, kernel & persistent naming covered\n'
      );
    }

    // ---------------------------------------------------------------------------
    // 5. ControlsEngineAdapter (Controls, Co-Sim & Simulink)
    // ---------------------------------------------------------------------------
    currentSection = '[5/13] ControlsEngineAdapter';
    console.log('[5/13] Testing ControlsEngineAdapter...');
    {
      const adapter = new ControlsEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'controls');
      assert.strictEqual(caps.supportedOperations.length, 4);

      // A. simulate_block_diagram
      const blockReq = new JobRequest({
        domain: 'controls',
        operation: 'simulate_block_diagram',
        parameters: {
          blocks: [
            { type: 'source_step', name: 'Step', params: { stepTime: 0.5, initialValue: 0, finalValue: 5 } },
            { type: 'gain', name: 'Gain', params: { k: 2.0 } },
            { type: 'scope', name: 'Scope', params: {} }
          ],
          connections: [
            { fromBlock: 'blk_000001', toBlock: 'blk_000002' },
            { fromBlock: 'blk_000002', toBlock: 'blk_000003' }
          ],
          tEnd: 2.0,
          dt: 0.05
        }
      });
      const blockRes = await adapter.execute(blockReq);
      assert.strictEqual(blockRes.status, JobStatus.SUCCEEDED);

      // B. solve_state_space
      const ssReq = new JobRequest({
        domain: 'controls',
        operation: 'solve_state_space',
        parameters: {
          A: [
            [0, 1],
            [-2, -3]
          ],
          B: [[0], [1]],
          C: [[1, 0]],
          D: [[0]],
          initialX: [0, 0],
          tEnd: 1.0,
          dt: 0.02,
          u: [1.0]
        }
      });
      const ssRes = await adapter.execute(ssReq);
      assert.strictEqual(ssRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(ssRes.outputData.dimensions.states, 2);

      // C. FMU co-simulation is unavailable through the serializable adapter contract.
      const fmiReq = new JobRequest({
        domain: 'controls',
        operation: 'fmi_cosimulation',
        parameters: { duration: 0.5, dt: 0.05, slaves: [{ instanceName: 'Slave1', variables: [] }] }
      });
      await assert.rejects(adapter.execute(fmiReq), (error) => error.code === OmniErrorCode.UNSUPPORTED);

      // D. solve_mpc
      const mpcReq = new JobRequest({
        domain: 'controls',
        operation: 'solve_mpc',
        parameters: {
          A: [
            [0.8, 0.1],
            [0.0, 0.9]
          ],
          B: [[0.05], [0.1]],
          C: [[1.0, 0.0]],
          predictionHorizon: 8,
          controlHorizon: 2,
          Q: [5.0],
          R: [0.1],
          uMin: [-5.0],
          uMax: [5.0],
          x0: [0.1, 0.0],
          reference: [1.0]
        }
      });
      const mpcRes = await adapter.execute(mpcReq);
      assert.strictEqual(mpcRes.status, JobStatus.SUCCEEDED);
      assert(Array.isArray(mpcRes.outputData.optimalControl));

      // E. estimate_ekf
      const ekfReq = new JobRequest({
        domain: 'controls',
        operation: 'estimate_ekf',
        parameters: {
          initialState: [0, 0, -50, 5, 0, 0, 1, 0, 0, 0],
          steps: [{ dt: 0.05, gyro: [0.01, 0, 0], accel: [0, 0, -9.81], baroAlt: 50.1, gpsPos: [0.25, 0, -50.1] }],
          recordTrajectory: true
        }
      });
      const ekfRes = await adapter.execute(ekfReq);
      assert.strictEqual(ekfRes.status, JobStatus.SUCCEEDED);
      assert(ekfRes.outputData.attitude !== undefined);

      // F. Validation errors
      await assert.rejects(
        adapter.execute(
          new JobRequest({ domain: 'controls', operation: 'solve_state_space', parameters: { A: [[1]] } })
        ),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'State space missing B, C, D must throw INVALID_INPUT'
      );

      // G. Additional Controls Delegates: Bode analyzer, Autocoder & LQR synthesis
      const bode = FrequencyResponseAnalyzer.computeBode([1], [1, 2, 1], 0.1, 100, 20);
      assert(bode.bodePoints.length === 20);

      const modelSpec = {
        name: 'TestController',
        A: [
          [0.95, 0.05],
          [0.0, 0.9]
        ],
        B: [[0.02], [0.08]],
        C: [[1.0, 0.0]],
        K: [[0.4, 0.15]],
        sampleRateHz: 50,
        standard: 'MISRA-C:2012'
      };
      const misraC = AutocoderCRust.generateMisraC(modelSpec);
      assert(typeof misraC.headerCode === 'string');
      const rustCode = AutocoderCRust.generateNoStdRust(modelSpec);
      assert(typeof rustCode === 'string');
      const autosar = AutocoderCRust.generateAutosarSWC(modelSpec);
      assert(typeof autosar.arxml === 'string');

      const lqrResult = ModernControlSynthesis.solveContinuousLQR(
        [
          [0, 1],
          [-2, -3]
        ],
        [[0], [1]],
        [
          [1, 0],
          [0, 1]
        ],
        [[1]],
        50,
        1e-6
      );
      assert(lqrResult.K !== undefined);

      passedTests++;
      console.log('  ✓ PASSED: ControlsEngineAdapter all 5 operations, validations, Bode, Autocoder & LQR covered\n');
    }

    // ---------------------------------------------------------------------------
    // 6. AerospaceEngineAdapter (Rocket Propulsion & Ascent)
    // ---------------------------------------------------------------------------
    currentSection = '[6/13] AerospaceEngineAdapter';
    console.log('[6/13] Testing AerospaceEngineAdapter...');
    {
      const adapter = new AerospaceEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'aerospace');
      assert.strictEqual(caps.supportedOperations.length, 11);
      assert(caps.supportedOperations.includes('compile_rocket_nozzle'));
      assert(caps.supportedOperations.includes('run_aerospace_cfd'));
      assert(caps.supportedOperations.includes('calculate_orbital_transfer'));

      // A. calculate_engine_performance
      const perfReq = new JobRequest({
        domain: 'aerospace',
        operation: 'calculate_engine_performance',
        parameters: {
          propellantType: 'LOX_LCH4',
          chamberPressureBar: 110.0,
          ofRatio: 3.4,
          throatDiameterM: 0.22,
          expansionRatio: 40.0
        }
      });
      const perfRes = await adapter.execute(perfReq);
      assert.strictEqual(perfRes.status, JobStatus.SUCCEEDED);
      assert(perfRes.outputData.thrustVacuumN > 0);

      // B. evaluate_combustion
      const combReq = new JobRequest({
        domain: 'aerospace',
        operation: 'evaluate_combustion',
        parameters: { propellantType: 'LOX_LCH4', chamberPressureBar: 100.0, ofRatio: 3.4 }
      });
      const combRes = await adapter.execute(combReq);
      assert.strictEqual(combRes.status, JobStatus.SUCCEEDED);
      assert(combRes.outputData.chamberTemperatureK > 2000);

      // C. simulate_ascent_trajectory
      const trajReq = new JobRequest({
        domain: 'aerospace',
        operation: 'simulate_ascent_trajectory',
        parameters: {
          initialMassKg: 50000,
          propellantMassKg: 45000,
          thrustVacuumN: 800000,
          ispVacuumS: 320,
          burnTimeS: 150,
          pitchKickAltM: 500
        }
      });
      const trajRes = await adapter.execute(trajReq);
      assert.strictEqual(trajRes.status, JobStatus.SUCCEEDED);

      // D. calculate_staging_deltav
      const stagingReq = new JobRequest({
        domain: 'aerospace',
        operation: 'calculate_staging_deltav',
        parameters: {
          payloadMassKg: 1500,
          stage1DryMassKg: 10000,
          stage1PropellantMassKg: 90000,
          stage1IspVac: 300,
          stage2DryMassKg: 2500,
          stage2PropellantMassKg: 17500,
          stage2IspVac: 350,
          gravityLossesM_s: 1200,
          aerodynamicLossesM_s: 300,
          steeringLossesM_s: 200,
          requiredDeltaV_m_s: 9000,
          inputSourceDescription: 'Test Mission Baseline'
        }
      });
      const stagingRes = await adapter.execute(stagingReq);
      assert.strictEqual(stagingRes.status, JobStatus.SUCCEEDED);
      assert(stagingRes.outputData.totalIdealDeltaV_m_s > 0);

      // E. calculate_isogrid_buckling
      const isogridReq = new JobRequest({
        domain: 'aerospace',
        operation: 'calculate_isogrid_buckling',
        parameters: {
          tankRadiusM: 1.5,
          axialLoadN: 500000,
          internalPressurePa: 250000,
          skinThicknessM: 0.002,
          ribHeightM: 0.015,
          ribWidthM: 0.002,
          gridTriangleHeightM: 0.08,
          elasticModulusPa: 71e9,
          poissonRatio: 0.33
        }
      });
      const isogridRes = await adapter.execute(isogridReq);
      assert.strictEqual(isogridRes.status, JobStatus.SUCCEEDED);

      // F. regenerative_cooling
      const coolReq = new JobRequest({
        domain: 'aerospace',
        operation: 'regenerative_cooling',
        parameters: {
          engineParameters: {
            propellantType: 'LOX_LCH4',
            chamberPressureBar: 100.0,
            ofRatio: 3.4,
            throatDiameterM: 0.2,
            expansionRatio: 30.0
          },
          coolantProps: {
            gasViscosityPaS: 8.5e-5,
            gasSpecificHeatJKgK: 2400,
            gasPrandtl: 0.82,
            bartzCorrectionFactor: 0.88,
            recoveryFactor: Math.pow(0.82, 0.33),
            throatRadiusOfCurvatureM: 0.174,
            coolantChannelCount: 500,
            channelWidthM: 0.0035,
            channelHeightM: 0.006,
            wallThicknessM: 0.001,
            coolantInletTempK: 110,
            coolantMassFlowKgS: 25.0,
            coolantDensityKgM3: 422,
            coolantViscosityPaS: 1.2e-4,
            coolantSpecificHeatJKgK: 3450,
            coolantPrandtl: 2.2,
            coolantThermalConductivityWmK: 0.18,
            linerThermalConductivityWmK: 325,
            effectiveHeatTransferAreaM2: 2.69,
            coolantChannelLengthM: 2.2,
            inputSourceDescription: 'Test baseline cooling parameters'
          }
        }
      });
      const coolRes = await adapter.execute(coolReq);
      assert.strictEqual(coolRes.status, JobStatus.SUCCEEDED);

      // G. turbopump_analysis
      const tpReq = new JobRequest({
        domain: 'aerospace',
        operation: 'turbopump_analysis',
        parameters: {
          engineParameters: {
            propellantType: 'LOX_LCH4',
            chamberPressureBar: 100.0,
            ofRatio: 3.4,
            throatDiameterM: 0.2,
            expansionRatio: 30.0
          },
          coolingResult: { coolantPressureDropPa: 2.0e6, success: true },
          pumpProps: {
            fuelDensityKgM3: 422,
            oxidizerDensityKgM3: 1141,
            fuelPumpEfficiency: 0.81,
            oxidizerPumpEfficiency: 0.78,
            injectorPressureDropPa: 4.5e6,
            oxidizerAdditionalPressureDropPa: 1.5e6,
            fuelPumpSpeedRPM: 42000,
            oxidizerPumpSpeedRPM: 28000,
            fuelImpellerTipSpeedM_s: 480,
            oxidizerImpellerTipSpeedM_s: 380,
            turbineEfficiency: 0.85,
            oxidizerTankPressurePa: 3.5e5,
            oxidizerVaporPressurePa: 1.05e5,
            oxidizerNpshRequiredM: 12,
            inputSourceDescription: 'Test baseline turbopump inputs'
          }
        }
      });
      const tpRes = await adapter.execute(tpReq);
      assert.strictEqual(tpRes.status, JobStatus.SUCCEEDED);

      // H. Validation errors
      await assert.rejects(
        adapter.execute(new JobRequest({ domain: 'aerospace', operation: 'regenerative_cooling', parameters: {} })),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'Missing regenerative_cooling inputs must throw INVALID_INPUT'
      );

      // I. Rocket nozzle compilation
      const nozzleReq = new JobRequest({
        domain: 'aerospace',
        operation: 'compile_rocket_nozzle',
        parameters: { chamberPressurePa: 7e6, expansionRatio: 16, throatAreaM2: 0.05, gamma: 1.22, chamberTempK: 3400 }
      });
      const nozzleRes = await adapter.execute(nozzleReq);
      assert.strictEqual(nozzleRes.status, JobStatus.SUCCEEDED);
      assert(nozzleRes.outputData.exitMach > 1);
      assert(Array.isArray(nozzleRes.outputData.contour) && nozzleRes.outputData.contour.length >= 32);
      assert(nozzleRes.outputData.thrustN > 0);

      // J. Supersonic shock-expansion CFD
      const cfdReq = new JobRequest({
        domain: 'aerospace',
        operation: 'run_aerospace_cfd',
        parameters: { machNumber: 3.0, angleOfAttackDeg: 0, altitudeM: 0, deflectionAngleDeg: 10, chordM: 2 }
      });
      const cfdRes = await adapter.execute(cfdReq);
      assert.strictEqual(cfdRes.status, JobStatus.SUCCEEDED);
      assert(Math.abs(cfdRes.outputData.cl) < 1e-6, 'Symmetric geometry at alpha=0 must produce CL ~ 0');
      assert(Number.isFinite(cfdRes.outputData.cd));

      // K. Hohmann orbital transfer
      const orbReq = new JobRequest({
        domain: 'aerospace',
        operation: 'calculate_orbital_transfer',
        parameters: { r1Meters: 6771000, r2Meters: 42164000 }
      });
      const orbRes = await adapter.execute(orbReq);
      assert.strictEqual(orbRes.status, JobStatus.SUCCEEDED);
      assert(orbRes.outputData.deltaVTotal > 0);
      assert(orbRes.outputData.timeOfFlightS > 0);

      await assert.rejects(
        adapter.execute(new JobRequest({ domain: 'aerospace', operation: 'compile_rocket_nozzle', parameters: {} })),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'Missing nozzle inputs must throw INVALID_INPUT'
      );
      await assert.rejects(
        adapter.execute(
          new JobRequest({
            domain: 'aerospace',
            operation: 'calculate_orbital_transfer',
            parameters: { r1Meters: 42164000, r2Meters: 6771000 }
          })
        ),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'Inward Hohmann transfer must throw INVALID_INPUT'
      );

      passedTests++;
      console.log('  ✓ PASSED: AerospaceEngineAdapter all 10 operations & cooling/turbopump validations covered\n');
    }

    // ---------------------------------------------------------------------------
    // 7. HPCEngineAdapter (Slurm, PBS & Domain Decomposition)
    // ---------------------------------------------------------------------------
    currentSection = '[7/13] HPCEngineAdapter';
    console.log('[7/13] Testing HPCEngineAdapter...');
    {
      const adapter = new HPCEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'hpc');
      assert.strictEqual(caps.supportedOperations.length, 7);

      // A. generate_slurm_script
      const slurmReq = new JobRequest({
        domain: 'hpc',
        operation: 'generate_slurm_script',
        parameters: {
          jobName: 'OmniSim',
          nodes: 4,
          ntasks: 32,
          partition: 'compute',
          walltime: '04:00:00',
          commands: ['srun ./solver_binary input.json']
        }
      });
      const slurmRes = await adapter.execute(slurmReq);
      assert.strictEqual(slurmRes.status, JobStatus.SUCCEEDED);
      assert(slurmRes.outputData.script.includes('#SBATCH'));

      // B. generate_pbs_script
      const pbsReq = new JobRequest({
        domain: 'hpc',
        operation: 'generate_pbs_script',
        parameters: {
          jobName: 'PbsSim',
          selectNodes: 2,
          ncpus: 16,
          walltime: '02:00:00',
          commands: ['mpirun -np 32 ./solver']
        }
      });
      const pbsRes = await adapter.execute(pbsReq);
      assert.strictEqual(pbsRes.status, JobStatus.SUCCEEDED);
      assert(pbsRes.outputData.script.includes('#PBS'));

      // C. partition_rcb
      const pts = Array.from({ length: 20 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5), z: (i * 7) % 11 }));
      const rcbReq = new JobRequest({
        domain: 'hpc',
        operation: 'partition_rcb',
        parameters: { points: pts, numPartitions: 4 }
      });
      const rcbRes = await adapter.execute(rcbReq);
      assert.strictEqual(rcbRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(rcbRes.outputData.numPartitions, 4);

      // D. plan_out_of_core
      const oocReq = new JobRequest({
        domain: 'hpc',
        operation: 'plan_out_of_core',
        parameters: {
          dofCount: 2000000,
          availableRamBytes: 8 * 1024 * 1024 * 1024,
          assumptions: { matrixNonzerosPerDof: 10, factorEntriesPerDof: 30 }
        }
      });
      const oocRes = await adapter.execute(oocReq);
      assert.strictEqual(oocRes.status, JobStatus.SUCCEEDED);
      assert(oocRes.outputData.totalChunks > 0);
      assert.strictEqual(oocRes.outputData.status, 'ESTIMATE_ONLY');

      // E. get_cluster_telemetry
      const telemReq = new JobRequest({ domain: 'hpc', operation: 'get_cluster_telemetry', parameters: {} });
      const telemRes = await adapter.execute(telemReq);
      assert.strictEqual(telemRes.status, JobStatus.SUCCEEDED);

      // F. Validation errors
      await assert.rejects(
        adapter.execute(new JobRequest({ domain: 'hpc', operation: 'partition_rcb', parameters: { points: 'bad' } })),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'Invalid points array must throw INVALID_INPUT'
      );

      passedTests++;
      console.log('  ✓ PASSED: HPCEngineAdapter all 6 operations, script generation & RCB covered\n');
    }

    // ---------------------------------------------------------------------------
    // 8. PDMEngineAdapter (eBOM Hierarchy & Visual Diff)
    // ---------------------------------------------------------------------------
    currentSection = '[8/13] PDMEngineAdapter';
    console.log('[8/13] Testing PDMEngineAdapter...');
    {
      const adapter = new PDMEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'pdm');
      assert.strictEqual(caps.supportedOperations.length, 7);

      const testBom = {
        partNumber: 'TOP-ASSY',
        name: 'Main Assembly',
        revision: 'A',
        quantity: 1,
        unitMassKg: 10.0,
        unitCostUsd: 250.0,
        children: [
          {
            partNumber: 'SUB-01',
            name: 'Sub-Assembly 1',
            revision: 'A',
            quantity: 2,
            unitMassKg: 2.5,
            unitCostUsd: 50.0,
            children: [
              {
                partNumber: 'PART-A',
                name: 'Pin',
                revision: 'A',
                quantity: 4,
                unitMassKg: 0.1,
                unitCostUsd: 2.0
              }
            ]
          },
          {
            partNumber: 'PART-B',
            name: 'Plate',
            revision: 'A',
            quantity: 1,
            unitMassKg: 3.0,
            unitCostUsd: 40.0
          }
        ]
      };

      // A. compute_bom_rollup
      const rollupReq = new JobRequest({
        domain: 'pdm',
        operation: 'compute_bom_rollup',
        parameters: { rootAssembly: testBom }
      });
      const rollupRes = await adapter.execute(rollupReq);
      assert.strictEqual(rollupRes.status, JobStatus.SUCCEEDED);
      assert(rollupRes.outputData.rollup.rolledUpMassKg > 0);

      // B. generate_indented_bom
      const indentedReq = new JobRequest({
        domain: 'pdm',
        operation: 'generate_indented_bom',
        parameters: { rootAssembly: testBom }
      });
      const indentedRes = await adapter.execute(indentedReq);
      assert.strictEqual(indentedRes.status, JobStatus.SUCCEEDED);
      assert(indentedRes.outputData.totalRows > 0);

      // C. generate_flattened_bom
      const flatReq = new JobRequest({
        domain: 'pdm',
        operation: 'generate_flattened_bom',
        parameters: { rootAssembly: testBom }
      });
      const flatRes = await adapter.execute(flatReq);
      assert.strictEqual(flatRes.status, JobStatus.SUCCEEDED);
      assert(flatRes.outputData.uniquePartCount > 0);

      // D. export_bom_csv ('indented' and 'flattened')
      const csvIndReq = new JobRequest({
        domain: 'pdm',
        operation: 'export_bom_csv',
        parameters: { rootAssembly: testBom, format: 'indented' }
      });
      const csvIndRes = await adapter.execute(csvIndReq);
      assert.strictEqual(csvIndRes.status, JobStatus.SUCCEEDED);
      assert(csvIndRes.outputData.csv.startsWith('Part Number,Description,'));
      assert(csvIndRes.outputData.csv.includes('"PART-A"'));

      const csvFlatReq = new JobRequest({
        domain: 'pdm',
        operation: 'export_bom_csv',
        parameters: { rootAssembly: testBom, format: 'flattened' }
      });
      const csvFlatRes = await adapter.execute(csvFlatReq);
      assert.strictEqual(csvFlatRes.status, JobStatus.SUCCEEDED);

      // E. where_used
      const whereReq = new JobRequest({
        domain: 'pdm',
        operation: 'where_used',
        parameters: { rootAssembly: testBom, partNumber: 'PART-A' }
      });
      const whereRes = await adapter.execute(whereReq);
      assert.strictEqual(whereRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(whereRes.outputData.totalOccurrences, 1);

      // F. validate_lifecycle
      const lifeReq = new JobRequest({
        domain: 'pdm',
        operation: 'validate_lifecycle',
        parameters: { rootAssembly: testBom, targetState: 'RELEASED', fromState: 'DRAFT', toState: 'RELEASED' }
      });
      const lifeRes = await adapter.execute(lifeReq);
      assert.strictEqual(lifeRes.status, JobStatus.SUCCEEDED);
      assert(lifeRes.outputData.errors.length > 0, 'DRAFT part inside RELEASED target must flag errors');

      // G. visual_diff_cad
      const diffReq = new JobRequest({
        domain: 'pdm',
        operation: 'visual_diff_cad',
        parameters: {
          revisionA: {
            commitId: 'coverage-revision-a',
            units: { length: 'mm', volume: 'mm3' },
            volumeMm3: 1000,
            faces: [{ id: 'face-a', centroidMm: { x: 0, y: 0, z: 0 } }]
          },
          revisionB: {
            commitId: 'coverage-revision-b',
            units: { length: 'mm', volume: 'mm3' },
            volumeMm3: 950,
            faces: [{ id: 'face-b', centroidMm: { x: 0.5, y: 0, z: 0 } }]
          }
        }
      });
      const diffRes = await adapter.execute(diffReq);
      assert.strictEqual(diffRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(diffRes.outputData.summary.modifiedCount, 1);

      // H. Validation errors
      await assert.rejects(
        adapter.execute(
          new JobRequest({ domain: 'pdm', operation: 'where_used', parameters: { rootAssembly: testBom } })
        ),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'where_used missing partNumber must throw INVALID_INPUT'
      );

      passedTests++;
      console.log('  ✓ PASSED: PDMEngineAdapter all 7 operations, BOM roll-up & visual diff covered\n');
    }

    // ---------------------------------------------------------------------------
    // 9. RoboticsEngineAdapter (Serial Manipulators, URDF & Kinematics)
    // ---------------------------------------------------------------------------
    currentSection = '[9/13] RoboticsEngineAdapter';
    console.log('[9/13] Testing RoboticsEngineAdapter...');
    {
      const adapter = new RoboticsEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'robotics');
      assert.strictEqual(caps.supportedOperations.length, 6);

      // A. forward_kinematics: custom DH, presets (PUMA_560, UR5E, KUKA_IIWA)
      const fkDhReq = new JobRequest({
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: {
          dhTable: [
            { a: 0.5, alpha: 0, d: 0 },
            { a: 0.5, alpha: 0, d: 0 }
          ],
          q: [0.1, -0.2]
        }
      });
      const fkDhRes = await adapter.execute(fkDhReq);
      assert.strictEqual(fkDhRes.status, JobStatus.SUCCEEDED);
      assert(fkDhRes.outputData.position !== undefined);

      const fkUr5eReq = new JobRequest({
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: { preset: 'UR5E', q: [0, -Math.PI / 2, 0, -Math.PI / 2, 0, 0] }
      });
      const fkUr5eRes = await adapter.execute(fkUr5eReq);
      assert.strictEqual(fkUr5eRes.status, JobStatus.SUCCEEDED);

      // B. forward_kinematics: Product of Exponentials (PoE)
      const fkPoeReq = new JobRequest({
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: {
          poeConfig: {
            screwAxes: [
              [0, 0, 1, 0, 0, 0],
              [0, 0, 1, 0, -1, 0]
            ],
            homeTransform: [
              [1, 0, 0, 2],
              [0, 1, 0, 0],
              [0, 0, 1, 0],
              [0, 0, 0, 1]
            ]
          },
          q: [0.2, -0.3]
        }
      });
      const fkPoeRes = await adapter.execute(fkPoeReq);
      assert.strictEqual(fkPoeRes.status, JobStatus.SUCCEEDED);

      // C. inverse_kinematics: 4x4 matrix & targetPosition
      const ikReq = new JobRequest({
        domain: 'robotics',
        operation: 'inverse_kinematics',
        parameters: {
          preset: 'UR5E',
          targetPose: [
            [1, 0, 0, 0.4],
            [0, 1, 0, 0.2],
            [0, 0, 1, 0.3],
            [0, 0, 0, 1]
          ],
          q0: [0, 0, 0, 0, 0, 0]
        }
      });
      const ikRes = await adapter.execute(ikReq);
      assert.strictEqual(ikRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(ikRes.outputData.converged, true);
      assert(Array.isArray(ikRes.outputData.qValues));
      assert.strictEqual(ikRes.outputData.qValues.length, 6);
      assert(ikRes.outputData.qValues.every(Number.isFinite));

      // D. inverse_dynamics: Recursive Newton-Euler
      const idReq = new JobRequest({
        domain: 'robotics',
        operation: 'inverse_dynamics',
        parameters: {
          dhTable: [
            { a: 0.5, alpha: 0, d: 0 },
            { a: 0.5, alpha: 0, d: 0 }
          ],
          q: [0.1, 0.2],
          qd: [0.5, -0.5],
          qdd: [1.0, -1.0],
          linkDynamics: [
            { mass: 2.0, com: [0, 0, 0], inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.1, iyz: 0, izz: 0.1 } },
            { mass: 1.5, com: [0, 0, 0], inertia: { ixx: 0.08, ixy: 0, ixz: 0, iyy: 0.08, iyz: 0, izz: 0.08 } }
          ],
          gravity: [0, 0, -9.80665],
          externalWrench: [0, 0, 0, 0, 0, 0]
        }
      });
      const idRes = await adapter.execute(idReq);
      assert.strictEqual(idRes.status, JobStatus.SUCCEEDED);

      // E. trajectory_plan: quintic polynomial
      const trajReq = new JobRequest({
        domain: 'robotics',
        operation: 'trajectory_plan',
        parameters: {
          q0: [0, 0],
          qf: [1, 1],
          duration: 2.0,
          numSteps: 10
        }
      });
      const trajRes = await adapter.execute(trajReq);
      assert.strictEqual(trajRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(trajRes.outputData.samples.length, 10);

      // F. parse_urdf: URDF XML & JSON
      const urdfXml = `
      <robot name="arm">
        <link name="base"/>
        <link name="link1"/>
        <joint name="joint1" type="revolute">
          <parent link="base"/>
          <child link="link1"/>
          <origin xyz="0 0 0.5" rpy="0 0 0"/>
          <axis xyz="0 0 1"/>
        </joint>
      </robot>
    `;
      const urdfReq = new JobRequest({
        domain: 'robotics',
        operation: 'parse_urdf',
        parameters: { urdf: urdfXml }
      });
      const urdfRes = await adapter.execute(urdfReq);
      assert.strictEqual(urdfRes.status, JobStatus.SUCCEEDED);

      // G. Validation error branches
      await assert.rejects(
        adapter.execute(
          new JobRequest({
            domain: 'robotics',
            operation: 'forward_kinematics',
            parameters: { dhTable: [{ a: 1, alpha: 0, d: 0 }], q: [0, 0] } // DOF mismatch
          })
        ),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'DOF mismatch must throw INVALID_INPUT'
      );

      await assert.rejects(
        adapter.execute(
          new JobRequest({
            domain: 'robotics',
            operation: 'forward_kinematics',
            parameters: { preset: 'UNKNOWN_ROBOT_PRESET', q: [0] }
          })
        ),
        (err) => err.code === OmniErrorCode.UNSUPPORTED,
        'Unknown robot preset must throw UNSUPPORTED'
      );

      passedTests++;
      console.log('  ✓ PASSED: RoboticsEngineAdapter all 5 operations, PoE, inverse dynamics & URDF covered\n');
    }

    // ---------------------------------------------------------------------------
    // 10. CAMEngineAdapter (CNC Toolpath & G-Code)
    // ---------------------------------------------------------------------------
    currentSection = '[10/13] CAMEngineAdapter';
    console.log('[10/13] Testing CAMEngineAdapter...');
    {
      const adapter = new CAMEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'cam');
      assert.strictEqual(caps.supportedOperations.length, 3);

      // A. plan_roughing_toolpath
      const roughReq = new JobRequest({
        domain: 'cam',
        operation: 'plan_roughing_toolpath',
        parameters: {
          bounds: { minX: 0, maxX: 60, minY: 0, maxY: 60, minZ: 0, maxZ: 15 },
          toolOptions: {
            toolDiameter: 10.0,
            toolType: 'flat_endmill',
            spindleRpm: 8000,
            feedRateMmMin: 1200,
            plungeRateMmMin: 300,
            stepoverMm: 4,
            stepdownMm: 5.0,
            safeZ: 20
          }
        }
      });
      const roughRes = await adapter.execute(roughReq);
      assert.strictEqual(roughRes.status, JobStatus.SUCCEEDED);
      assert(roughRes.outputData.layers.length > 0);
      const toolOptions = {
        toolDiameter: 8.0,
        toolType: 'flat_endmill',
        feedRateMmMin: 1200,
        plungeRateMmMin: 300,
        spindleRpm: 8000,
        stepoverMm: 3.2,
        stepdownMm: 2.5,
        safeZ: 15
      };
      const gcodePlan = await adapter.execute(
        new JobRequest({
          domain: 'cam',
          operation: 'plan_roughing_toolpath',
          parameters: {
            bounds: { minX: 0, maxX: 50, minY: 0, maxY: 50, minZ: 0, maxZ: 10 },
            toolOptions
          }
        })
      );

      // B. generate_gcode
      const gcodeReq = new JobRequest({
        domain: 'cam',
        operation: 'generate_gcode',
        parameters: {
          toolpaths: gcodePlan.outputData,
          toolOptions,
          programNumber: 'O2002'
        }
      });
      const gcodeRes = await adapter.execute(gcodeReq);
      assert.strictEqual(gcodeRes.status, JobStatus.SUCCEEDED);
      assert(gcodeRes.outputData.gcode.includes('G21'));

      // C. Validation & Cancellation
      await assert.rejects(
        adapter.execute(new JobRequest({ domain: 'cam', operation: 'unknown_cam_op' })),
        (err) => err.code === OmniErrorCode.UNSUPPORTED,
        'Unsupported CAM operation must throw UNSUPPORTED'
      );

      passedTests++;
      console.log('  ✓ PASSED: CAMEngineAdapter roughing toolpaths and ISO G-Code generation covered\n');
    }

    // ---------------------------------------------------------------------------
    // 11. FEAEngineAdapter & CFDEngineAdapter (CAE & CFD)
    // ---------------------------------------------------------------------------
    currentSection = '[11/13] FEAEngineAdapter & CFDEngineAdapter';
    console.log('[11/13] Testing FEAEngineAdapter & CFDEngineAdapter...');
    {
      // FEAEngineAdapter
      const feaAdapter = new FEAEngineAdapter();
      const feaCaps = feaAdapter.describeCapabilities();
      assert.strictEqual(feaCaps.domain, 'cae');
      assert.deepStrictEqual(feaCaps.supportedOperations, ['linear_elastic_3d', 'drop_test', 'mesh_planar_polygon_2d']);

      // A. linear_elastic_3d
      const feaReq = new JobRequest({
        domain: 'cae',
        operation: 'linear_elastic_3d',
        parameters: {
          nodes: [
            { x: 0, y: 0, z: 0, fixed: [true, true, true] },
            { x: 5, y: 0, z: 0, fixed: [true, true, true] },
            { x: 0, y: 5, z: 0, fixed: [true, true, true] },
            { x: 0, y: 0, z: 5, force: [0, 0, 1000] }
          ],
          elements: [{ nodeIds: [0, 1, 2, 3], material: { E: 70e9, nu: 0.33, yieldStress: 250e6 } }]
        }
      });
      const feaRes = await feaAdapter.execute(feaReq);
      assert.strictEqual(feaRes.status, JobStatus.SUCCEEDED);
      assert(feaRes.outputData.maxStress > 0);

      // B. The low-level TET10 element is available for experimental use, but no assembled
      //    continuum plasticity solver is configured in this adapter.
      await assert.rejects(
        feaAdapter.execute(
          new JobRequest({
            domain: 'cae',
            operation: 'continuum_plasticity_3d',
            parameters: { mesh: { nodes: [], elements: [] } }
          })
        ),
        (err) => err.code === OmniErrorCode.UNSUPPORTED
      );

      // C. drop_test
      const dropReq = new JobRequest({
        domain: 'cae',
        operation: 'drop_test',
        parameters: { dropHeightM: 1.5, phoneMassKg: 0.25, impactAngle: 'corner' }
      });
      const dropRes = await feaAdapter.execute(dropReq);
      assert.strictEqual(dropRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(dropRes.outputData.validationLevel, 'experimental');
      assert.strictEqual(dropRes.outputData.inputs.dropHeightM, 1.5);
      assert.strictEqual(dropRes.outputData.inputs.phoneMassKg, 0.25);
      assert.strictEqual(dropRes.outputData.inputs.impactAngle, 'corner');
      await assert.rejects(
        feaAdapter.execute(new JobRequest({ domain: 'cae', operation: 'drop_test', parameters: { dropHeightM: 1.5 } })),
        (err) => err.code === OmniErrorCode.INVALID_INPUT
      );

      // CFDEngineAdapter
      const cfdAdapter = new CFDEngineAdapter();
      const cfdCaps = cfdAdapter.describeCapabilities();
      assert.strictEqual(cfdCaps.domain, 'cfd');
      assert.strictEqual(cfdCaps.supportedOperations.length, 2);

      // D. fvm_navier_stokes_3d
      const cfdReq = new JobRequest({
        domain: 'cfd',
        operation: 'fvm_navier_stokes_3d',
        parameters: { nx: 4, ny: 4, nz: 4, steps: 3, inletVelocity: 12.0 }
      });
      const cfdRes = await cfdAdapter.execute(cfdReq);
      assert.strictEqual(cfdRes.status, JobStatus.SUCCEEDED);
      assert(cfdRes.outputData.cellCount > 0);

      // Error branch: unsupported op
      await assert.rejects(
        feaAdapter.execute(new JobRequest({ domain: 'cae', operation: 'unknown_fea_op' })),
        (err) => err.code === OmniErrorCode.UNSUPPORTED
      );
      await assert.rejects(
        cfdAdapter.execute(new JobRequest({ domain: 'cfd', operation: 'unknown_cfd_op' })),
        (err) => err.code === OmniErrorCode.UNSUPPORTED
      );

      passedTests++;
      console.log(
        '  ✓ PASSED: FEAEngineAdapter (elastic, drop, explicit plasticity unavailability) & CFDEngineAdapter (FVM) covered\n'
      );
    }

    // ---------------------------------------------------------------------------
    // 12. EDAEngineAdapter (SPICE, DRC, STA, Synthesis, OASIS & PEX)
    // ---------------------------------------------------------------------------
    currentSection = '[12/13] EDAEngineAdapter';
    console.log('[12/13] Testing EDAEngineAdapter...');
    {
      const adapter = new EDAEngineAdapter();
      const caps = adapter.describeCapabilities();
      assert.strictEqual(caps.domain, 'eda');
      assert.strictEqual(caps.supportedOperations.length, 15);

      // A. simulate_spice_dc
      const dcReq = new JobRequest({
        domain: 'eda',
        operation: 'simulate_spice_dc',
        parameters: {
          components: [
            { type: 'V', id: 'V1', nPlus: '1', nMinus: '0', dcValue: 5.0 },
            { type: 'R', id: 'R1', n1: '1', n2: '2', value: 1000.0 },
            { type: 'R', id: 'R2', n1: '2', n2: '0', value: 1000.0 }
          ]
        }
      });
      const dcRes = await adapter.execute(dcReq);
      assert.strictEqual(dcRes.status, JobStatus.SUCCEEDED);
      assert(Math.abs(dcRes.outputData.nodeVoltages['2'] - 2.5) <= 5e-6);

      // B. simulate_spice_transient
      const tranReq = new JobRequest({
        domain: 'eda',
        operation: 'simulate_spice_transient',
        parameters: {
          components: [
            { type: 'V', id: 'V1', nPlus: '1', nMinus: '0', dcValue: 5.0 },
            { type: 'R', id: 'R1', n1: '1', n2: '2', value: 500.0 },
            { type: 'C', id: 'C1', n1: '2', n2: '0', value: 1e-6 }
          ],
          tStop: 0.002,
          dt: 1e-4
        }
      });
      const tranRes = await adapter.execute(tranReq);
      assert.strictEqual(tranRes.status, JobStatus.SUCCEEDED);

      // C. static_timing_analysis
      const staReq = new JobRequest({
        domain: 'eda',
        operation: 'static_timing_analysis',
        parameters: {
          name: 'CriticalDataPath',
          clockPeriodNs: 5.0,
          clockSkewNs: 0.05,
          tLaunchCqNs: 0.25,
          tSetupNs: 0.1,
          tHoldNs: 0.05,
          gateDelaysNs: [0.3, 0.4],
          wireDelaysNs: [0.1, 0.15]
        }
      });
      const staRes = await adapter.execute(staReq);
      assert.strictEqual(staRes.status, JobStatus.SUCCEEDED);
      assert(staRes.outputData.maxAchievableFrequencyMHz > 0);

      // D. extract_wire_parasitics
      const pexReq = new JobRequest({
        domain: 'eda',
        operation: 'extract_wire_parasitics',
        parameters: { lengthMm: 1.5, widthUm: 1.0, thicknessUm: 0.5, dielectricHeightUm: 1.0, dielectricConstant: 3.9 }
      });
      const pexRes = await adapter.execute(pexReq);
      assert.strictEqual(pexRes.status, JobStatus.SUCCEEDED);

      // E. run_drc
      const drcReq = new JobRequest({
        domain: 'eda',
        operation: 'run_drc',
        parameters: {
          shapes: [
            { id: 'm1', layer: 'metal1', x: 0, y: 0, w: 10, h: 5 },
            { id: 'm2', layer: 'metal1', x: 15, y: 0, w: 10, h: 5 }
          ],
          rules: { minWidth: 2, minSpacing: 3, minArea: 5 }
        }
      });
      const drcRes = await adapter.execute(drcReq);
      assert.strictEqual(drcRes.status, JobStatus.SUCCEEDED);

      // F. synthesize_logic
      const synthReq = new JobRequest({
        domain: 'eda',
        operation: 'synthesize_logic',
        parameters: {
          verilogSource:
            'module half_adder(input a, input b, output s, output c); assign s = a ^ b; assign c = a & b; endmodule'
        }
      });
      const synthRes = await adapter.execute(synthReq);
      assert.strictEqual(synthRes.status, JobStatus.SUCCEEDED);

      // G. place_and_route
      const pnrReq = new JobRequest({
        domain: 'eda',
        operation: 'place_and_route',
        parameters: {
          circuitData: { cells: [{ id: 'u1', x: 20, y: 20, w: 10, h: 10 }], nets: [] }
        }
      });
      const pnrRes = await adapter.execute(pnrReq);
      assert.strictEqual(pnrRes.status, JobStatus.SUCCEEDED);

      // H. serialize_oasis & deserialize_oasis
      const oasisSerReq = new JobRequest({
        domain: 'eda',
        operation: 'serialize_oasis',
        parameters: { layout: { cells: [] } }
      });
      const oasisSerRes = await adapter.execute(oasisSerReq);
      assert.strictEqual(oasisSerRes.status, JobStatus.SUCCEEDED);

      const oasisDesReq = new JobRequest({
        domain: 'eda',
        operation: 'deserialize_oasis',
        parameters: { bytes: oasisSerRes.outputData.bytes }
      });
      const oasisDesRes = await adapter.execute(oasisDesReq);
      assert.strictEqual(oasisDesRes.status, JobStatus.SUCCEEDED);

      // I. evaluate_crosstalk
      const xtalkReq = new JobRequest({
        domain: 'eda',
        operation: 'evaluate_crosstalk',
        parameters: {
          spec: {
            aggressorVoltageSwingV: 1.2,
            aggressorTransitionTimePs: 50,
            couplingCapacitanceFf: 10,
            victimGroundCapacitanceFf: 100,
            victimDriverResistanceOhms: 50,
            noiseMarginThresholdV: 0.2,
            pulseWidthTimeConstantFactor: 2
          }
        }
      });
      const xtalkRes = await adapter.execute(xtalkReq);
      assert.strictEqual(xtalkRes.status, JobStatus.SUCCEEDED);
      assert(Number.isFinite(xtalkRes.outputData.peakGlitchVoltageV));
      assert.strictEqual(xtalkRes.outputData.validationLevel, 'experimental');

      // J. analyze_ir_drop & calculate_electromigration
      const irReq = new JobRequest({
        domain: 'eda',
        operation: 'analyze_ir_drop',
        parameters: {
          vdd: 1.2,
          maxDropThresholdPercent: 5,
          metalThickness: 0.28e-6,
          rows: 3,
          cols: 3,
          pitchX: 2e-6,
          pitchY: 2e-6,
          sheetRho: 0.05,
          wireWidth: 1e-6,
          padNodeIds: [0],
          currentLoads: [{ nodeId: 4, current: 0.002 }]
        }
      });
      const irRes = await adapter.execute(irReq);
      assert.strictEqual(irRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(irRes.outputData.validationLevel, 'experimental');
      await assert.rejects(
        adapter.execute(
          new JobRequest({
            domain: 'eda',
            operation: 'analyze_ir_drop',
            parameters: { rows: 3, cols: 3, padNodeIds: [0], currentLoads: [] }
          })
        ),
        (err) => err.code === OmniErrorCode.INVALID_INPUT
      );

      const emReq = new JobRequest({
        domain: 'eda',
        operation: 'calculate_electromigration',
        parameters: {
          currentDensity: 5e5,
          tempC: 90,
          model: {
            preExponentialCoefficient: 1,
            activationEnergyEV: 0.7,
            currentDensityExponent: 1,
            boltzmannEVPerK: 8.617333262e-5,
            provenance: 'synthetic test-only caller input; not material reliability data'
          }
        }
      });
      const emRes = await adapter.execute(emReq);
      assert.strictEqual(emRes.status, JobStatus.SUCCEEDED);
      assert.strictEqual(emRes.outputData.dataStatus, 'caller-supplied-unverified');

      // K. Validation errors: unsupported circuit component
      await assert.rejects(
        adapter.execute(
          new JobRequest({
            domain: 'eda',
            operation: 'simulate_spice_dc',
            parameters: { components: [{ type: 'UNKNOWN_PART' }] }
          })
        ),
        (err) => err.code === OmniErrorCode.UNSUPPORTED
      );

      passedTests++;
      console.log('  ✓ PASSED: EDAEngineAdapter SPICE, DRC, STA, PEX, OASIS, Crosstalk & IR-Drop covered\n');
    }

    // ---------------------------------------------------------------------------
    // 13. EngineRegistry (Unified Central Registry & Dispatch)
    // ---------------------------------------------------------------------------
    currentSection = '[13/13] EngineRegistry';
    console.log('[13/13] Testing EngineRegistry unified dispatch & execution...');
    {
      const registry = createDefaultEngineRegistry();
      const domains = registry.listRegisteredDomains();
      assert.strictEqual(domains.length, 12);
      assert.strictEqual(registry.listDomains().length, 12);

      for (const d of domains) {
        assert.strictEqual(registry.hasAdapter(d), true);
        assert.strictEqual(registry.has(d), true);
        const ad = registry.getAdapter(d);
        assert.strictEqual(ad.domain, d);
        assert.strictEqual(registry.get(d).domain, d);
      }

      const allCaps = registry.describeAllCapabilities();
      assert.strictEqual(Object.keys(allCaps).length, 12);

      // Registry dispatch across multiple domains
      const req1 = new JobRequest({
        domain: 'cad',
        operation: 'evaluate_nurbs',
        parameters: {
          surface: {
            controlPoints: [
              [
                [0, 0, 0],
                [10, 0, 0]
              ],
              [
                [0, 10, 0],
                [10, 10, 0]
              ]
            ],
            degreeU: 1,
            degreeV: 1
          },
          u: 0.5,
          v: 0.5
        }
      });
      const res1 = await registry.dispatch(req1);
      assert.strictEqual(res1.status, JobStatus.SUCCEEDED);

      // executeJob helper with domain string + request
      const res2 = await registry.executeJob('cad', req1);
      assert.strictEqual(res2.status, JobStatus.SUCCEEDED);

      // executeJob helper with request only
      const res3 = await registry.executeJob(req1);
      assert.strictEqual(res3.status, JobStatus.SUCCEEDED);

      // Registry error branches
      await assert.rejects(
        registry.dispatch(new JobRequest({ domain: 'non_existent_domain', operation: 'foo' })),
        (err) => err.code === OmniErrorCode.UNSUPPORTED,
        'Dispatch to non-existent domain must throw UNSUPPORTED'
      );

      assert.throws(
        () => registry.register(null),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'register(null) must throw INVALID_INPUT'
      );

      assert.throws(
        () => registry.getAdapter(''),
        (err) => err.code === OmniErrorCode.INVALID_INPUT,
        'getAdapter("") must throw INVALID_INPUT'
      );

      passedTests++;
      console.log('  ✓ PASSED: EngineRegistry registration, capability enumeration and dispatch covered\n');
    }
  } catch (error) {
    failedTests++;
    console.error(`  ✗ FAILED: ${currentSection}`);
    console.error(error?.stack || error);
  } finally {
    await getGlobalPersistentWorkerPool().terminateAll();
  }

  const totalTests = passedTests + failedTests;
  console.log('================================================================');
  console.log(`   ENGINE ADAPTER COVERAGE: ${passedTests}/${totalTests} sections passed; ${failedTests} failed`);
  console.log('================================================================\n');

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

if (require.main === module) {
  runEngineAdaptersCoverageTests()
    .then((stats) => {
      if (stats.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('Test suite setup failed:', error?.stack || error);
      process.exitCode = 1;
    });
}

module.exports = { runEngineAdaptersCoverageTests };
