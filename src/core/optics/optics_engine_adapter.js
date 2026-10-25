'use strict';

const { EngineAdapter } = require('../contracts/EngineAdapter');
const { JobResult, JobStatus } = require('../contracts/JobResult');
const { JobEvent, JobEventType } = require('../contracts/JobEvent');
const { ValidationMaturity } = require('../contracts/ValidationRecord');
const { OmniError, OmniErrorCode } = require('../contracts/OmniError');

const { SkewRayTracer } = require('./skew_ray_tracer');
const { OpticalGlassCatalog } = require('./optical_glass_catalog');
const { PolarizationRayTracer, JonesVector, Complex } = require('./polarization_ray_tracer');

function requirePupilGenerationInputs(params) {
  const pupilRadiusMm = params.pupilRadiusMm ?? params.entrancePupilRadiusMm;
  const { numRings, raysPerRing, fieldAngleDeg, wavelengthUm, pupilPlaneZMm } = params;
  if (typeof pupilRadiusMm !== 'number' || !Number.isFinite(pupilRadiusMm) || pupilRadiusMm <= 0) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, 'A finite positive pupil radius in millimeters is required.');
  }
  if (!Number.isInteger(numRings) || numRings < 1 || numRings > 20) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Pupil ring count must be an integer from 1 through 20.');
  }
  if (!Number.isInteger(raysPerRing) || raysPerRing < 1 || raysPerRing > 64) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Rays per ring must be an integer from 1 through 64.');
  }
  if (
    typeof fieldAngleDeg !== 'number' ||
    !Number.isFinite(fieldAngleDeg) ||
    fieldAngleDeg < -89 ||
    fieldAngleDeg > 89
  ) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Field angle must be finite and between -89 and 89 degrees.');
  }
  if (typeof wavelengthUm !== 'number' || !Number.isFinite(wavelengthUm) || wavelengthUm <= 0) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, 'A finite positive wavelength in micrometers is required.');
  }
  if (typeof pupilPlaneZMm !== 'number' || !Number.isFinite(pupilPlaneZMm)) {
    throw new OmniError(
      OmniErrorCode.INVALID_INPUT,
      'An explicit finite entrance pupil plane position in millimeters is required.'
    );
  }
  return { pupilRadiusMm, numRings, raysPerRing, fieldAngleDeg, wavelengthUm, pupilPlaneZMm };
}

function validateOpticalSurfaces(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length < 1 || surfaces.length > 128) {
    throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Supply between 1 and 128 optical surfaces.');
  }
  for (const [index, surface] of surfaces.entries()) {
    if (
      !surface ||
      typeof surface.radius !== 'number' ||
      !Number.isFinite(surface.radius) ||
      typeof surface.zVertex !== 'number' ||
      !Number.isFinite(surface.zVertex) ||
      typeof surface.clearRadius !== 'number' ||
      !Number.isFinite(surface.clearRadius) ||
      surface.clearRadius <= 0 ||
      ![surface.nIncident, surface.nTransmitted].every(
        (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
      ) ||
      typeof surface.conic !== 'number' ||
      !Number.isFinite(surface.conic) ||
      !Array.isArray(surface.asphericCoeffs) ||
      surface.asphericCoeffs.length !== 4 ||
      !surface.asphericCoeffs.every(Number.isFinite)
    ) {
      throw new OmniError(
        OmniErrorCode.INVALID_INPUT,
        `Optical surface ${index} requires explicit finite geometry, aperture, indices, conic, and aspheric coefficients.`
      );
    }
  }
}

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
          const surfaces = params.surfaces;
          validateOpticalSurfaces(surfaces);
          if (params.rays !== undefined && !Array.isArray(params.rays)) {
            throw new OmniError(OmniErrorCode.INVALID_INPUT, 'Caller-supplied rays must be an array.');
          }

          let rays;
          let rayGeneration = null;
          if (params.rays?.length) {
            rays = params.rays.map((ray, index) => {
              try {
                return SkewRayTracer.createRay(ray.origin, ray.direction, ray.wavelengthUm, ray.intensity);
              } catch (error) {
                throw new OmniError(OmniErrorCode.INVALID_INPUT, `Ray ${index}: ${error.message}`);
              }
            });
          } else {
            rayGeneration = requirePupilGenerationInputs(params);
            rays = SkewRayTracer.generatePupilRayGrid(
              rayGeneration.pupilRadiusMm,
              rayGeneration.numRings,
              rayGeneration.raysPerRing,
              rayGeneration.fieldAngleDeg,
              rayGeneration.wavelengthUm,
              rayGeneration.pupilPlaneZMm
            );
          }

          onEvent(
            new JobEvent({
              jobId,
              type: JobEventType.PROGRESS,
              progressPercent: 50,
              message: `Tracing ${rays.length} skew rays through ${surfaces.length} surfaces`
            })
          );
          const sensorZ = params.sensorZ;
          if (typeof sensorZ !== 'number' || !Number.isFinite(sensorZ)) {
            throw new OmniError(
              OmniErrorCode.INVALID_INPUT,
              'An explicit finite sensor z position in millimeters is required.'
            );
          }
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
            rays: tracedRays,
            rayGeneration
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
          const rayGeneration = requirePupilGenerationInputs(params);
          const rays = SkewRayTracer.generatePupilRayGrid(
            rayGeneration.pupilRadiusMm,
            rayGeneration.numRings,
            rayGeneration.raysPerRing,
            rayGeneration.fieldAngleDeg,
            rayGeneration.wavelengthUm,
            rayGeneration.pupilPlaneZMm
          );
          outputData = { rayCount: rays.length, rays, rayGeneration };
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
          if (Object.hasOwn(params, 'crystal')) {
            // Birefringent crystal walk-off and splitting calculation
            const crystal = params.crystal;
            const rayDirection = params.rayDirection;
            const surfaceNormal = params.surfaceNormal;
            const validVector = (value) =>
              Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) && Math.hypot(...value) > 0;
            if (
              !crystal ||
              typeof crystal !== 'object' ||
              ![crystal.no, crystal.ne].every(
                (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
              ) ||
              !validVector(crystal.opticAxis) ||
              !validVector(rayDirection) ||
              !validVector(surfaceNormal)
            ) {
              throw new OmniError(
                OmniErrorCode.INVALID_INPUT,
                'Crystal splitting requires positive no/ne values and explicit nonzero optic-axis, ray-direction, and surface-normal vectors.'
              );
            }
            outputData = PolarizationRayTracer.splitBirefringentRay(crystal, rayDirection, surfaceNormal);
          } else if (Object.hasOwn(params, 'fresnel')) {
            const { n1, n2, thetaI } = params.fresnel || {};
            if (
              ![n1, n2].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0) ||
              typeof thetaI !== 'number' ||
              !Number.isFinite(thetaI) ||
              thetaI < 0 ||
              thetaI >= Math.PI / 2
            ) {
              throw new OmniError(
                OmniErrorCode.INVALID_INPUT,
                'Fresnel evaluation requires positive incident/transmitted indices and an explicit incidence angle in radians from 0 inclusive to π/2 exclusive.'
              );
            }
            outputData = PolarizationRayTracer.evaluateFresnel(n1, n2, thetaI);
          } else {
            // Jones vector transmission through optical polarizers and retarders
            if (
              typeof params.Ex !== 'number' ||
              !Number.isFinite(params.Ex) ||
              typeof params.ExImag !== 'number' ||
              !Number.isFinite(params.ExImag) ||
              typeof params.Ey !== 'number' ||
              !Number.isFinite(params.Ey) ||
              typeof params.EyImag !== 'number' ||
              !Number.isFinite(params.EyImag) ||
              !Array.isArray(params.elements)
            ) {
              throw new OmniError(
                OmniErrorCode.INVALID_INPUT,
                'Jones propagation requires explicit finite real and imaginary Ex/Ey field components and an elements array.'
              );
            }
            let jv = new JonesVector(new Complex(params.Ex, params.ExImag), new Complex(params.Ey, params.EyImag));
            const stokesIn = jv.toStokes();

            for (const [index, el] of params.elements.entries()) {
              if (!el || typeof el !== 'object' || !Number.isFinite(el.angleDeg)) {
                throw new OmniError(
                  OmniErrorCode.INVALID_INPUT,
                  `Polarization element ${index} needs an explicit finite angle in degrees.`
                );
              }
              const theta = (el.angleDeg * Math.PI) / 180;
              const c = Math.cos(theta);
              const s = Math.sin(theta);
              switch (el.type) {
                case 'linear_polarizer': {
                  const J = [
                    [new Complex(c * c, 0), new Complex(c * s, 0)],
                    [new Complex(c * s, 0), new Complex(s * s, 0)]
                  ];
                  jv = jv.applyMatrix(J);
                  break;
                }
                case 'rotator': {
                  const J = [
                    [new Complex(c, 0), new Complex(-s, 0)],
                    [new Complex(s, 0), new Complex(c, 0)]
                  ];
                  jv = jv.applyMatrix(J);
                  break;
                }
                default:
                  throw new OmniError(
                    OmniErrorCode.UNSUPPORTED,
                    `Polarization element type '${el.type}' is unsupported.`
                  );
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
