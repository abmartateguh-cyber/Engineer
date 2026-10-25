/**
 * OmniEng Optics Domain IPC Router & Schema Definitions
 * Covers Paraxial Optics, Skew Ray Tracing, Aspherics, Thin Films, Thermal Soak, PSF/MTF, DLS
 */

'use strict';

const { defineHandler, validateSchema } = require('./define_handler');
const { OpticalEngine } = require('../../core/optics/optical_engine');
const { SkewRayTracer } = require('../../core/optics/skew_ray_tracer');
const { AsphericSurface, DielectricThinFilm } = require('../../core/optics/aspheric_freeform_optics');
const { OpticalThermalSoakEngine } = require('../../core/optics/thermal_soak');
const { DiffractionPSFMTFEngine } = require('../../core/optics/diffraction_psf_mtf');
const { DampedLeastSquaresOptimizer } = require('../../core/optics/damped_least_squares_optimizer');
const { Vector3 } = require('../../core/math/linear_algebra');
const { ZemaxZmxImporter } = require('../../core/optics/zmx_importer');
const { PolarizationRayTracer, Complex, JonesVector } = require('../../core/optics/polarization_ray_tracer');

const OPTICAL_SURFACE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['radius', 'zVertex', 'clearRadius', 'nIncident', 'nTransmitted', 'conic', 'asphericCoeffs'],
  properties: {
    radius: { type: 'number' },
    zVertex: { type: 'number' },
    clearRadius: { type: 'number', min: Number.MIN_VALUE },
    nIncident: { type: 'number', min: Number.MIN_VALUE },
    nTransmitted: { type: 'number', min: Number.MIN_VALUE },
    conic: { type: 'number' },
    asphericCoeffs: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number' } }
  }
});

const SKEW_RAY_TRACE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'surfaces',
    'entrancePupilRadiusMm',
    'wavelengthUm',
    'numRings',
    'raysPerRing',
    'fieldAngleDeg',
    'sensorZMm'
  ],
  properties: {
    surfaces: { type: 'array', minItems: 2, maxItems: 128, items: OPTICAL_SURFACE_SCHEMA },
    entrancePupilRadiusMm: { type: 'number', min: Number.MIN_VALUE },
    wavelengthUm: { type: 'number', min: Number.MIN_VALUE },
    numRings: { type: 'number', integer: true, min: 1, max: 20 },
    raysPerRing: { type: 'number', integer: true, min: 1, max: 64 },
    fieldAngleDeg: { type: 'number', min: -89, max: 89 },
    sensorZMm: { type: 'number' }
  }
});

const SKEW_OPTICS_SCHEMA = Object.freeze({
  ...SKEW_RAY_TRACE_SCHEMA,
  required: [...SKEW_RAY_TRACE_SCHEMA.required, 'fStop', 'maxFrequencyLpMm'],
  properties: {
    ...SKEW_RAY_TRACE_SCHEMA.properties,
    fStop: { type: 'number', min: Number.MIN_VALUE },
    maxFrequencyLpMm: { type: 'number', min: Number.MIN_VALUE, max: 10000 }
  }
});

const VECTOR3_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'z'],
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }
});

const ASPHERIC_OPTICS_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'curvaturePerMm',
    'conic',
    'semiDiameterMm',
    'coefficients',
    'evaluationRadiusMm',
    'normalPointMm',
    'vertexZMm',
    'rayOriginMm',
    'rayDirection',
    'maxIterations',
    'toleranceMm'
  ],
  properties: {
    curvaturePerMm: { type: 'number' },
    conic: { type: 'number' },
    semiDiameterMm: { type: 'number', min: Number.MIN_VALUE },
    coefficients: {
      type: 'object',
      additionalProperties: false,
      required: ['alpha4', 'alpha6', 'alpha8', 'alpha10', 'alpha12'],
      properties: {
        alpha4: { type: 'number' },
        alpha6: { type: 'number' },
        alpha8: { type: 'number' },
        alpha10: { type: 'number' },
        alpha12: { type: 'number' }
      }
    },
    evaluationRadiusMm: { type: 'number', min: 0 },
    normalPointMm: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y'],
      properties: { x: { type: 'number' }, y: { type: 'number' } }
    },
    vertexZMm: { type: 'number' },
    rayOriginMm: VECTOR3_SCHEMA,
    rayDirection: VECTOR3_SCHEMA,
    maxIterations: { type: 'number', integer: true, min: 1, max: 100 },
    toleranceMm: { type: 'number', min: Number.MIN_VALUE }
  }
});

const THIN_FILM_COATING_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['substrateIndex', 'incidentIndex', 'layers', 'wavelengthNm', 'thetaDeg'],
  properties: {
    substrateIndex: { type: 'number', min: Number.MIN_VALUE },
    incidentIndex: { type: 'number', min: Number.MIN_VALUE },
    layers: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['refractiveIndex', 'thicknessNm'],
        properties: {
          refractiveIndex: { type: 'number', min: Number.MIN_VALUE },
          thicknessNm: { type: 'number', min: Number.MIN_VALUE }
        }
      }
    },
    wavelengthNm: { type: 'number', min: Number.MIN_VALUE },
    thetaDeg: { type: 'number', min: 0, max: 89.999999 }
  }
});

const THERMAL_PROPERTIES_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['D0PerK', 'D1PerK2', 'D2PerK3', 'E0Um2PerK', 'E1Um2PerK2', 'lambdaTkUm', 'glassCtePerK', 'source'],
  properties: {
    D0PerK: { type: 'number' },
    D1PerK2: { type: 'number' },
    D2PerK3: { type: 'number' },
    E0Um2PerK: { type: 'number' },
    E1Um2PerK2: { type: 'number' },
    lambdaTkUm: { type: 'number', min: Number.MIN_VALUE },
    glassCtePerK: { type: 'number' },
    source: { type: 'string', maxLength: 500 }
  }
});

const OPTICAL_THERMAL_SOAK_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'housingCtePerK',
    'housingCteSource',
    'elements',
    'targetTempC',
    'referenceTempC',
    'wavelengthUm',
    'pressurePa'
  ],
  properties: {
    housingCtePerK: { type: 'number' },
    housingCteSource: { type: 'string', maxLength: 500 },
    elements: {
      type: 'array',
      minItems: 1,
      maxItems: 128,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'radius1Mm',
          'radius2Mm',
          'thicknessMm',
          'airGapMm',
          'refractiveIndexAtReferenceTemperature',
          'thermalProperties'
        ],
        properties: {
          radius1Mm: { type: 'number' },
          radius2Mm: { type: 'number' },
          thicknessMm: { type: 'number', min: Number.MIN_VALUE },
          airGapMm: { type: 'number', min: 0 },
          refractiveIndexAtReferenceTemperature: { type: 'number', min: Number.MIN_VALUE },
          thermalProperties: THERMAL_PROPERTIES_SCHEMA
        }
      }
    },
    targetTempC: { type: 'number' },
    referenceTempC: { type: 'number' },
    wavelengthUm: { type: 'number', min: Number.MIN_VALUE },
    pressurePa: { type: 'number', min: Number.MIN_VALUE }
  }
});

const WAVEFRONT_PSF_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['gridSize', 'wavelengthUm', 'fNumber', 'defocusWaves', 'sphericalWaves'],
  properties: {
    gridSize: { type: 'number', integer: true, min: 16, max: 256 },
    wavelengthUm: { type: 'number', min: Number.MIN_VALUE },
    fNumber: { type: 'number', min: Number.MIN_VALUE },
    defocusWaves: { type: 'number' },
    sphericalWaves: { type: 'number' }
  }
});

const POLARIZATION_TRACE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['fresnel', 'birefringent-split', 'stokes'] },
    n1: { type: 'number', min: Number.MIN_VALUE },
    n2: { type: 'number', min: Number.MIN_VALUE },
    thetaRad: { type: 'number', min: 0, max: Math.PI / 2 - 1e-9 },
    thetaDeg: { type: 'number', min: 0, max: 89.999999 },
    crystalProps: {
      type: 'object',
      additionalProperties: false,
      required: ['no', 'ne', 'opticAxis'],
      properties: {
        no: { type: 'number', min: Number.MIN_VALUE },
        ne: { type: 'number', min: Number.MIN_VALUE },
        opticAxis: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } }
      }
    },
    rayDir: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
    surfaceNorm: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
    Ex: { type: 'number' },
    Ey: { type: 'number' },
    ExImag: { type: 'number' },
    EyImag: { type: 'number' }
  }
});

function getOpticalGlassCatalogUnavailableResult() {
  return {
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: {
      code: 'UNSUPPORTED',
      message:
        'Optical glass records are unavailable until source, applicability, and redistribution rights are reviewed.'
    }
  };
}

function getOpticalTolerancingUnavailableResult() {
  return {
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: {
      code: 'UNSUPPORTED',
      message:
        'Optical tolerance analysis is unavailable pending a sourced prescription, reviewed tolerances, and independent validation.'
    }
  };
}

function invalidOpticalInput(message) {
  return {
    success: false,
    status: 'invalid-input',
    validationLevel: 'experimental',
    error: { code: 'INVALID_INPUT', message }
  };
}

function numericalOpticalFailure(message) {
  return {
    success: false,
    status: 'numerical-failure',
    validationLevel: 'experimental',
    error: { code: 'NUMERICAL_FAILURE', message }
  };
}

function containsOnlyFiniteNumbers(value, seen = new Set()) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return Array.from(value).every(Number.isFinite);
  return Object.values(value).every((entry) => containsOnlyFiniteNumbers(entry, seen));
}

function guardOpticalNumerics(result, message) {
  return containsOnlyFiniteNumbers(result) ? result : numericalOpticalFailure(message);
}

function validateOpticalInput(params, schema) {
  try {
    validateSchema(params, schema);
    return null;
  } catch (error) {
    return invalidOpticalInput(error.message);
  }
}

function runAsphericOptics(params) {
  const invalid = validateOpticalInput(params, ASPHERIC_OPTICS_SCHEMA);
  if (invalid) return invalid;
  const { curvaturePerMm, conic, semiDiameterMm, coefficients } = params;
  const normalRadiusMm = Math.hypot(params.normalPointMm.x, params.normalPointMm.y);
  if (params.evaluationRadiusMm > semiDiameterMm || normalRadiusMm > semiDiameterMm) {
    return invalidOpticalInput('Sag and normal evaluation coordinates must lie within the supplied semi-diameter.');
  }
  const conicDomainAtAperture = 1 - (1 + conic) * curvaturePerMm * curvaturePerMm * semiDiameterMm * semiDiameterMm;
  if (!Number.isFinite(conicDomainAtAperture) || conicDomainAtAperture < 0) {
    return invalidOpticalInput('The supplied conic does not define a real surface over the full clear aperture.');
  }

  const direction = new Vector3(params.rayDirection.x, params.rayDirection.y, params.rayDirection.z);
  const directionMagnitude = direction.length();
  if (!Number.isFinite(directionMagnitude) || directionMagnitude <= 1e-12) {
    return invalidOpticalInput('Ray direction must have finite, nonzero magnitude.');
  }
  direction.scale(1 / directionMagnitude);

  const surface = new AsphericSurface({
    radius: curvaturePerMm === 0 ? Infinity : 1 / curvaturePerMm,
    conic,
    semiDiameter: semiDiameterMm,
    coefficients
  });
  const normal = surface.evaluateNormal(params.normalPointMm.x, params.normalPointMm.y);
  const localOrigin = new Vector3(params.rayOriginMm.x, params.rayOriginMm.y, params.rayOriginMm.z - params.vertexZMm);
  const localHit = surface.intersectRay(localOrigin, direction, params.maxIterations, params.toleranceMm);
  let hit = localHit;
  if (localHit.hit) {
    if (Math.hypot(localHit.point.x, localHit.point.y) > semiDiameterMm) {
      hit = { hit: false, reason: 'outside_aperture' };
    } else {
      hit = {
        ...localHit,
        point: new Vector3(localHit.point.x, localHit.point.y, localHit.point.z + params.vertexZMm)
      };
    }
  }

  return guardOpticalNumerics(
    {
      success: true,
      validationLevel: 'experimental',
      sagMm: surface.evaluateSag(params.evaluationRadiusMm),
      normal: normal.toArray(),
      hit: hit.hit ? { hit: true, tMm: hit.t, pointMm: hit.point.toArray(), normal: hit.normal.toArray() } : hit,
      normalizedRayDirection: direction.toArray(),
      warnings: ['Experimental aspheric geometry; independent optical validation is unavailable.']
    },
    'Aspheric evaluation produced a non-finite numerical result.'
  );
}

function runThinFilmCoating(params) {
  const invalid = validateOpticalInput(params, THIN_FILM_COATING_SCHEMA);
  if (invalid) return invalid;

  const coating = new DielectricThinFilm(params.substrateIndex);
  for (const layer of params.layers) coating.addLayer(layer.refractiveIndex, layer.thicknessNm);
  const result = coating.evaluate(params.wavelengthNm, params.thetaDeg, params.substrateIndex, params.incidentIndex);
  return guardOpticalNumerics(
    {
      success: true,
      validationLevel: 'experimental',
      result,
      warnings: ['Experimental transfer-matrix estimate; independent coating measurements are unavailable.']
    },
    'Thin-film evaluation produced a non-finite numerical result.'
  );
}

function runOpticalThermalSoak(params) {
  const invalid = validateOpticalInput(params, OPTICAL_THERMAL_SOAK_SCHEMA);
  if (invalid) return invalid;
  if (params.targetTempC <= -273.15 || params.referenceTempC <= -273.15) {
    return invalidOpticalInput('Temperatures must be above absolute zero.');
  }
  if (
    typeof params.housingCteSource !== 'string' ||
    !params.housingCteSource.trim() ||
    params.elements.some((element) => {
      const properties = element.thermalProperties;
      return (
        element.radius1Mm === 0 ||
        element.radius2Mm === 0 ||
        !properties.source.trim() ||
        Math.abs(params.wavelengthUm * params.wavelengthUm - properties.lambdaTkUm * properties.lambdaTkUm) < 1e-15
      );
    })
  ) {
    return invalidOpticalInput(
      'Nonzero radii, distinct wavelength/thermal constants, and nonempty property sources are required.'
    );
  }

  const result = OpticalThermalSoakEngine.evaluateThermalSoakFromProperties(
    {
      housingCtePerK: params.housingCtePerK,
      housingCteSource: params.housingCteSource,
      elements: params.elements
    },
    params.targetTempC,
    params.referenceTempC,
    params.wavelengthUm,
    params.pressurePa
  );
  if (result.success === false) return result;
  return guardOpticalNumerics(
    {
      success: true,
      validationLevel: 'experimental',
      result,
      warnings: ['Material coefficients are caller-supplied and not independently reviewed or validated.']
    },
    'Thermal evaluation produced a non-finite numerical result.'
  );
}

function runWavefrontPSF(params) {
  const invalid = validateOpticalInput(params, WAVEFRONT_PSF_SCHEMA);
  if (invalid) return invalid;
  if ((params.gridSize & (params.gridSize - 1)) !== 0) {
    return invalidOpticalInput('Grid size must be a power of two from 16 through 256.');
  }

  const { isDiffractionLimited: _thresholdVerdict, ...result } =
    DiffractionPSFMTFEngine.evaluateWavefrontPSFandMTF(params);
  return guardOpticalNumerics(
    {
      success: true,
      validationLevel: 'experimental',
      result,
      warnings: ['Experimental scalar pupil model; no independent optical transfer validation is available.']
    },
    'Wavefront evaluation produced a non-finite numerical result.'
  );
}

function vectorHasMagnitude(vector) {
  return Array.isArray(vector) && Math.hypot(...vector) > 1e-12;
}

function runPolarizationTrace(params) {
  const invalid = validateOpticalInput(params, POLARIZATION_TRACE_SCHEMA);
  if (invalid) return invalid;

  if (params.action === 'fresnel') {
    const hasRadians = params.thetaRad !== undefined;
    const hasDegrees = params.thetaDeg !== undefined;
    if (params.n1 === undefined || params.n2 === undefined || hasRadians === hasDegrees) {
      return invalidOpticalInput('Fresnel analysis requires n1, n2, and exactly one of thetaRad or thetaDeg.');
    }
    const thetaRad = hasRadians ? params.thetaRad : (params.thetaDeg * Math.PI) / 180;
    return guardOpticalNumerics(
      {
        success: true,
        validationLevel: 'experimental',
        action: 'fresnel',
        n1: params.n1,
        n2: params.n2,
        ...PolarizationRayTracer.evaluateFresnel(params.n1, params.n2, thetaRad),
        warnings: ['Ideal-interface Fresnel calculation; independent optical validation is unavailable.']
      },
      'Fresnel evaluation produced a non-finite numerical result.'
    );
  }

  if (params.action === 'birefringent-split') {
    if (
      !params.crystalProps ||
      !params.rayDir ||
      !params.surfaceNorm ||
      !vectorHasMagnitude(params.crystalProps.opticAxis) ||
      !vectorHasMagnitude(params.rayDir) ||
      !vectorHasMagnitude(params.surfaceNorm)
    ) {
      return invalidOpticalInput(
        'Birefringent splitting requires nonzero optic-axis, ray-direction, and surface-normal vectors with explicit indices.'
      );
    }
    return guardOpticalNumerics(
      {
        success: true,
        validationLevel: 'experimental',
        action: 'birefringent-split',
        ...PolarizationRayTracer.splitBirefringentRay(params.crystalProps, params.rayDir, params.surfaceNorm),
        warnings: ['Experimental uniaxial ray split; independent optical validation is unavailable.']
      },
      'Birefringent evaluation produced a non-finite numerical result.'
    );
  }

  if ([params.Ex, params.Ey, params.ExImag, params.EyImag].some((value) => value === undefined)) {
    return invalidOpticalInput('Stokes analysis requires explicit Ex, Ey, ExImag, and EyImag field components.');
  }
  const jones = new JonesVector(new Complex(params.Ex, params.ExImag), new Complex(params.Ey, params.EyImag));
  return guardOpticalNumerics(
    {
      success: true,
      validationLevel: 'experimental',
      action: 'stokes',
      stokes: jones.toStokes(),
      warnings: ['Idealized Jones/Stokes calculation; independent optical validation is unavailable.']
    },
    'Stokes evaluation produced a non-finite numerical result.'
  );
}

function runOpticalDLS(params = {}) {
  try {
    if (!params.system || !Array.isArray(params.system.surfaces) || params.system.surfaces.length < 2) {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Supply a caller-provided optical system with at least two surfaces.' }
      };
    }
    if (!Array.isArray(params.variables) || params.variables.length === 0) {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Supply at least one bounded optimization variable.' }
      };
    }
    if (!Array.isArray(params.operands) || params.operands.length === 0) {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Supply at least one explicit merit operand.' }
      };
    }
    if (!params.options || typeof params.options !== 'object' || Array.isArray(params.options)) {
      return { success: false, error: { code: 'INVALID_INPUT', message: 'Supply all optimizer controls explicitly.' } };
    }

    const optimizer = new DampedLeastSquaresOptimizer(params.options);
    const result = optimizer.optimize(params.system, params.variables, params.operands);
    return { success: true, ...result };
  } catch (error) {
    return {
      success: false,
      error: {
        code: error instanceof TypeError ? 'INVALID_INPUT' : 'NUMERICAL_FAILURE',
        message: error.message
      }
    };
  }
}

function runZmxImport(params = {}) {
  const content = params.content;
  if (typeof content !== 'string' || !content.trim()) {
    return { success: false, error: { code: 'INVALID_INPUT', message: 'Provide ZMX text content to parse.' } };
  }

  const system = ZemaxZmxImporter.parse(content);
  if (
    system.surfaces.length < 2 ||
    !system.surfaces.every(
      (surface) =>
        Number.isFinite(surface.curvature) &&
        Number.isFinite(surface.thickness) &&
        Number.isFinite(surface.semiDiameter) &&
        Number.isFinite(surface.conic)
    )
  ) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', message: 'The ZMX text must contain at least two parseable surfaces.' }
    };
  }

  return {
    success: true,
    validationLevel: 'experimental',
    system,
    surfaces: system.surfaces,
    paraxial: system.metrics
  };
}

function runSkewRayTrace(params) {
  const rays = SkewRayTracer.generatePupilRayGrid(
    params.entrancePupilRadiusMm,
    params.numRings,
    params.raysPerRing,
    params.fieldAngleDeg,
    params.wavelengthUm
  );
  const tracedRays = SkewRayTracer.traceOpticalSystem(params.surfaces, rays, params.sensorZMm);
  return {
    success: true,
    validationLevel: 'experimental',
    surfaces: params.surfaces,
    rays: tracedRays,
    requestedRayCount: rays.length,
    terminatedRayCount: tracedRays.filter((ray) => ray.isTerminated).length,
    warnings: ['Experimental ray trace; independent optical validation is unavailable.']
  };
}

function runSkewOptics(params) {
  const trace = runSkewRayTrace(params);
  const spotData = SkewRayTracer.computeSpotDiagram(trace.rays);
  if (spotData.count === 0) {
    return {
      success: false,
      status: 'numerical-failure',
      validationLevel: 'experimental',
      error: { code: 'NUMERICAL_FAILURE', message: 'No rays reached the requested image plane.' },
      requestedRayCount: trace.requestedRayCount,
      terminatedRayCount: trace.terminatedRayCount
    };
  }

  const mtfData = SkewRayTracer.computeMTFCurve(
    spotData.rmsSpotRadiusMm,
    params.fStop,
    params.maxFrequencyLpMm,
    params.wavelengthUm * 1000
  );
  return {
    success: true,
    validationLevel: 'experimental',
    surfaces: trace.surfaces,
    rays: trace.rays,
    requestedRayCount: trace.requestedRayCount,
    terminatedRayCount: trace.terminatedRayCount,
    spotData,
    mtfData,
    aperture: params.fStop,
    wavelengthNm: params.wavelengthUm * 1000,
    maxFrequencyLpMm: params.maxFrequencyLpMm,
    warnings: [
      ...trace.warnings,
      'The MTF curve uses an RMS-spot approximation and is not an independently validated optical transfer calculation.'
    ]
  };
}

function registerOpticsIpc() {
  // 1. Solve Paraxial Optics Metrics
  defineHandler(
    'omni:solve-optics',
    {
      type: 'object',
      required: ['focalLengthMm', 'fStop', 'subjectDistM', 'wavelengthNm', 'circleOfConfusionMm'],
      additionalProperties: false,
      properties: {
        focalLengthMm: { type: 'number', min: 0 },
        fStop: { type: 'number', min: 0 },
        subjectDistM: { type: 'number', min: 0 },
        wavelengthNm: { type: 'number', min: 0 },
        circleOfConfusionMm: { type: 'number', min: 0 }
      }
    },
    async (event, params) => {
      const { focalLengthMm, fStop, subjectDistM, wavelengthNm, circleOfConfusionMm } = params;
      return OpticalEngine.solveOpticalMetrics(focalLengthMm, fStop, subjectDistM, wavelengthNm, circleOfConfusionMm);
    },
    {
      domain: 'optics',
      description:
        'Calculate experimental scalar optics estimates from explicit focal length, f-number, subject distance, wavelength, and circle of confusion'
    }
  );

  // 2. Trace Paraxial Rays
  defineHandler(
    'omni:trace-rays',
    {
      ...SKEW_RAY_TRACE_SCHEMA
    },
    async (event, params) => runSkewRayTrace(params),
    {
      domain: 'optics',
      description:
        'Experimental ray trace through explicitly supplied optical surfaces; no default prescription or independent validation is available'
    }
  );

  // 3. Get Lens Prescription
  defineHandler(
    'omni:get-lens-prescription',
    {
      type: 'object',
      optional: true,
      additionalProperties: false,
      properties: {}
    },
    async () => ({
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: { code: 'UNSUPPORTED', message: 'No source-reviewed optical prescription is bundled.' }
    }),
    { domain: 'optics', description: 'Optical prescription unavailable pending source and redistribution review' }
  );

  // 4. Solve Skew Optics & Spot / MTF
  defineHandler(
    'omni:solve-skew-optics',
    {
      ...SKEW_OPTICS_SCHEMA
    },
    async (event, params) => runSkewOptics(params),
    {
      domain: 'optics',
      description:
        'Experimental vector ray trace and spot/MTF estimates from an explicitly supplied surface system; independent validation is unavailable'
    }
  );

  // 5. Evaluate Aspheric Freeform Optics
  defineHandler(
    'omni:evaluate-aspheric-optics',
    ASPHERIC_OPTICS_SCHEMA,
    async (event, params) => runAsphericOptics(params),
    {
      domain: 'optics',
      description:
        'Experimental aspheric surface evaluation using explicit curvature, coefficients, coordinates, and ray data'
    }
  );

  // 6. Evaluate Dielectric Thin-Film Coating
  defineHandler(
    'omni:evaluate-thin-film-coating',
    THIN_FILM_COATING_SCHEMA,
    async (event, params) => runThinFilmCoating(params),
    {
      domain: 'optics',
      description: 'Experimental transfer-matrix estimate using an explicitly supplied coating stack and optical inputs'
    }
  );

  // 7. Optical Thermal Soak & CTE Expansion
  defineHandler(
    'omni:evaluate-optical-thermal-soak',
    OPTICAL_THERMAL_SOAK_SCHEMA,
    async (event, params) => runOpticalThermalSoak(params),
    {
      domain: 'optics',
      description:
        'Experimental thin-lens thermal estimate from explicitly supplied geometry, material coefficients, temperatures, wavelength, and pressure'
    }
  );

  // 8. 2D FFT Wavefront PSF & MTF
  defineHandler('omni:evaluate-wavefront-psf', WAVEFRONT_PSF_SCHEMA, async (event, params) => runWavefrontPSF(params), {
    domain: 'optics',
    description:
      'Experimental scalar pupil PSF/MTF estimate from explicit grid, wavelength, aperture, and wavefront terms'
  });

  // 9. Damped Least Squares (DLS) Optimizer
  defineHandler(
    'omni:optimize-optical-dls',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      return runOpticalDLS(params);
    },
    { domain: 'optics', description: 'Levenberg-Marquardt DLS merit function optimization' }
  );

  // 10. Legacy .ZMX-format lens prescription importer
  defineHandler(
    'omni:import-zmx-optics',
    {
      type: 'object',
      optional: true,
      properties: {
        content: { type: 'string', maxLength: 5 * 1024 * 1024 }
      }
    },
    async (event, params = {}) => runZmxImport(params),
    {
      domain: 'optics',
      description: 'Experimental parser for legacy .zmx format; compatibility is not independently verified'
    }
  );

  // 11. Polarization Ray Tracing & Birefringence (Phase 6)
  defineHandler(
    'omni:trace-polarization-ray',
    POLARIZATION_TRACE_SCHEMA,
    async (event, params) => runPolarizationTrace(params),
    {
      domain: 'optics',
      description:
        'Experimental polarization calculations from an explicit action and supplied optical values or field components'
    }
  );

  // 12. Unavailable optical glass catalog compatibility endpoint
  defineHandler(
    'omni:query-glass-catalog',
    {
      type: 'object',
      optional: true
    },
    async () => getOpticalGlassCatalogUnavailableResult(),
    {
      domain: 'optics',
      description: 'Unavailable pending optical glass source, applicability, and redistribution review'
    }
  );

  // 13. Unavailable optical tolerancing compatibility endpoint
  defineHandler(
    'omni:run-optical-tolerancing',
    {
      type: 'object',
      optional: true
    },
    async () => getOpticalTolerancingUnavailableResult(),
    {
      domain: 'optics',
      description: 'Unavailable pending a sourced optical prescription, reviewed tolerances, and independent validation'
    }
  );

  // 14. Withdrawn synthetic camera-lens example
  defineHandler(
    'omni:get-camera-lens-master',
    {
      type: 'object',
      optional: true
    },
    async () => ({
      success: false,
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message: 'The synthetic lens prescription and unmeasured performance example were withdrawn.'
      }
    }),
    {
      domain: 'optics',
      description: 'Withdrawn synthetic lens example; independent prescription and performance evidence are unavailable'
    }
  );
}

module.exports = {
  registerOpticsIpc,
  runOpticalDLS,
  runZmxImport,
  runSkewRayTrace,
  runSkewOptics,
  runAsphericOptics,
  runThinFilmCoating,
  runOpticalThermalSoak,
  runWavefrontPSF,
  runPolarizationTrace,
  SKEW_RAY_TRACE_SCHEMA,
  SKEW_OPTICS_SCHEMA,
  ASPHERIC_OPTICS_SCHEMA,
  THIN_FILM_COATING_SCHEMA,
  OPTICAL_THERMAL_SOAK_SCHEMA,
  WAVEFRONT_PSF_SCHEMA,
  POLARIZATION_TRACE_SCHEMA,
  getOpticalGlassCatalogUnavailableResult,
  getOpticalTolerancingUnavailableResult
};
