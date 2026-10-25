'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { SkewRayTracer } = require('./skew_ray_tracer');
const { OpticalGlassCatalog } = require('./optical_glass_catalog');
const { PolarizationRayTracer, JonesVector, Complex } = require('./polarization_ray_tracer');

/**
 * OpticsEngineAdapter: Standard EngineAdapter for 3D Skew Ray Tracing, Polarization Optics, and Glass Dispersion
 */
class OpticsEngineAdapter extends EngineAdapter {
  constructor() {
    super('optics', 'optics-raytracing-engine-adapter', '2.0.0');
    this.catalog = new OpticalGlassCatalog();
  }

  describeCapabilities() {
    return {
      domain: 'optics',
      name: this.name,
      version: this.version,
      supportedOperations: [
        'trace_skew_rays',
        'generate_pupil_rays',
        'calculate_refractive_index',
        'trace_polarization'
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
      new JobEvent({
        jobId,
        type: JobEventType.STARTED,
        message: `Starting optics operation "${jobRequest.operation}"`
      })
    );

    if (signal?.aborted) {
      throw new OmniError(OmniErrorCode.CANCELLED, 'Job cancelled before execution');
    }

    try {
      let outputData = null;
      const params = jobRequest.parameters || {};

      switch (jobRequest.operation) {
        case 'trace_skew_rays': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 20,
              message: 'Validating optical surfaces and ray bundle'
            })
          );
          const surfaces = params.surfaces || [];
          let rays = params.rays || [];

          if (rays.length === 0 && params.pupilRadiusMm) {
            rays = SkewRayTracer.generatePupilRayGrid(
              params.pupilRadiusMm,
              params.numRings || 4,
              params.raysPerRing || 8,
              params.fieldAngleDeg || 0,
              params.wavelengthUm || 0.5875618
            );
          } else {
            // Normalize custom input rays
            rays = rays.map((r) => SkewRayTracer.createRay(r.origin, r.direction, r.wavelengthUm, r.intensity));
          }

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: `Tracing ${rays.length} skew rays through ${surfaces.length} surfaces`
            })
          );
          const sensorZ = params.sensorZ !== undefined ? Number(params.sensorZ) : undefined;
          const tracedRays = SkewRayTracer.traceOpticalSystem(surfaces, rays, sensorZ);

          const activeCount = tracedRays.filter((r) => !r.isTerminated).length;
          const tirCount = tracedRays.filter((r) => r.isTIR).length;

          // Spot coordinates at image plane
          const spotDiagram = tracedRays
            .filter((r) => !r.isTerminated)
            .map((r) => ({
              x: Number(r.x.toFixed(4)),
              y: Number(r.y.toFixed(4)),
              z: Number(r.z.toFixed(4)),
              intensity: r.intensity
            }));

          outputData = {
            totalRays: tracedRays.length,
            activeRays: activeCount,
            tirRays: tirCount,
            spotDiagram,
            rays: tracedRays
          };
          break;
        }

        case 'generate_pupil_rays': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: 'Generating circular pupil ray mesh'
            })
          );
          const rays = SkewRayTracer.generatePupilRayGrid(
            params.pupilRadiusMm || 10.0,
            params.numRings || 4,
            params.raysPerRing || 8,
            params.fieldAngleDeg || 0.0,
            params.wavelengthUm || 0.5875618
          );
          outputData = { rayCount: rays.length, rays };
          break;
        }

        case 'calculate_refractive_index': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 30,
              message: 'Evaluating dispersion equation'
            })
          );
          let catalog = this.catalog;
          if (params.customGlassRecord) {
            catalog = new OpticalGlassCatalog([params.customGlassRecord]);
          }

          const glass = params.glass ?? params.customGlassRecord?.name;
          const wavelengthUm = params.wavelengthUm;
          const temperatureC = params.temperatureC;
          if (typeof glass !== 'string' || !glass.trim()) {
            throw new OmniError(OmniErrorCode.INVALID_INPUT, 'An optical material name is required.');
          }
          if (typeof wavelengthUm !== 'number' || !Number.isFinite(wavelengthUm) || wavelengthUm <= 0) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'A finite positive wavelength in micrometers is required.'
            );
          }
          if (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC) || temperatureC <= -273.15) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'A finite temperature above absolute zero in degrees Celsius is required.'
            );
          }
          const glassRecord = catalog.getGlass(glass);
          if (!glassRecord) {
            throw new OmniError(
              OmniErrorCode.UNSUPPORTED,
              `Optical material '${glass}' is unavailable; supply an explicit material record.`
            );
          }
          if (temperatureC !== glassRecord.referenceTemperatureC && glassRecord.dndTPerK === undefined) {
            throw new OmniError(
              OmniErrorCode.UNSUPPORTED,
              'A caller-supplied dndTPerK coefficient is required for non-reference temperatures.'
            );
          }

          const n = catalog.calculateIndex(glass, wavelengthUm, temperatureC);
          const properties = catalog.getOpticalProperties(glass, temperatureC);

          outputData = {
            glass,
            wavelengthUm,
            temperatureC,
            refractiveIndex: Number(n.toFixed(6)),
            properties
          };
          break;
        }

        case 'trace_polarization': {
          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 40,
              message: 'Evaluating polarization state, Jones matrix, and Stokes parameters'
            })
          );
          if (params.crystal) {
            // Birefringent crystal walk-off and splitting calculation
            outputData = PolarizationRayTracer.splitBirefringentRay(
              params.crystal,
              params.rayDirection || [0, 0, 1],
              params.surfaceNormal || [0, 0, 1]
            );
          } else if (params.fresnel) {
            outputData = PolarizationRayTracer.evaluateFresnel(
              params.fresnel.n1 || 1.0,
              params.fresnel.n2 || 1.5,
              params.fresnel.thetaI || 0.0
            );
          } else {
            // Jones vector transmission through optical polarizers and retarders
            let jv = new JonesVector(
              params.Ex !== undefined ? params.Ex : 1.0,
              params.Ey !== undefined ? params.Ey : 0.0
            );
            const stokesIn = jv.toStokes();

            if (Array.isArray(params.elements)) {
              for (const el of params.elements) {
                switch (el.type) {
                  case 'linear_polarizer': {
                    const theta = ((el.angleDeg || 0.0) * Math.PI) / 180;
                    const c = Math.cos(theta);
                    const s = Math.sin(theta);
                    const J = [
                      [new Complex(c * c, 0), new Complex(c * s, 0)],
                      [new Complex(c * s, 0), new Complex(s * s, 0)]
                    ];
                    jv = jv.applyMatrix(J);
                    break;
                  }
                  case 'rotator': {
                    const theta = ((el.angleDeg || 0.0) * Math.PI) / 180;
                    const c = Math.cos(theta);
                    const s = Math.sin(theta);
                    const J = [
                      [new Complex(c, 0), new Complex(-s, 0)],
                      [new Complex(s, 0), new Complex(c, 0)]
                    ];
                    jv = jv.applyMatrix(J);
                    break;
                  }
                  default:
                    break;
                }
              }
            }

            const stokesOut = jv.toStokes();
            outputData = {
              initialStokes: stokesIn,
              finalStokes: stokesOut,
              dop: stokesOut.DOP,
              intensity: jv.intensity()
            };
          }
          break;
        }

        default:
          throw new OmniError(
            OmniErrorCode.UNSUPPORTED,
            `Operation "${jobRequest.operation}" not implemented in OpticsEngineAdapter`
          );
      }

      onEvent(
        new JobEvent({ jobId, type: JobEventType.PROGRESS, progressPercent: 100, message: 'Optics operation complete' })
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
  OpticsEngineAdapter
};
