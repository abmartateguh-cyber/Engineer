/**
 * OmniEng Optics Domain IPC Router & Schema Definitions
 * Covers Paraxial Optics, Skew Ray Tracing, Aspherics, Thin Films, Thermal Soak, PSF/MTF, DLS
 */

'use strict';

const { defineHandler } = require('./define_handler');
const { OpticalEngine } = require('../../core/optics/optical_engine');
const { SkewRayTracer } = require('../../core/optics/skew_ray_tracer');
const { AsphericSurface, DielectricThinFilm } = require('../../core/optics/aspheric_freeform_optics');
const { OpticalThermalSoakEngine } = require('../../core/optics/thermal_soak');
const { DiffractionPSFMTFEngine } = require('../../core/optics/diffraction_psf_mtf');
const { DampedLeastSquaresOptimizer } = require('../../core/optics/damped_least_squares_optimizer');
const { Vector3 } = require('../../core/math/linear_algebra');
const { ZemaxZmxImporter } = require('../../core/optics/zmx_importer');

function registerOpticsIpc() {
  // 1. Solve Paraxial Optics Metrics
  defineHandler('omni:solve-optics', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { focalLengthMm = 50.0, fStop = 1.4, subjectDistM = 2.0 } = params;
    return OpticalEngine.solveOpticalMetrics(focalLengthMm, fStop, subjectDistM);
  }, { domain: 'optics', description: 'Solve cardinal points, entrance/exit pupils, and EFL' });

  // 2. Trace Paraxial Rays
  defineHandler('omni:trace-rays', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { fStop = 1.4, rayCount = 9 } = params;
    return OpticalEngine.traceRays(fStop, rayCount);
  }, { domain: 'optics', description: 'Trace paraxial marginal and chief rays through lens surfaces' });

  // 3. Get Lens Prescription
  defineHandler('omni:get-lens-prescription', {
    optional: true
  }, async () => {
    return OpticalEngine.get50mmPrescription();
  }, { domain: 'optics', description: 'Retrieve 50mm f/1.4 Double Gauss optical prescription' });

  // 4. Solve Skew Optics & Spot / MTF
  defineHandler('omni:solve-skew-optics', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const surfaces = OpticalEngine.getOpticalSurfaces();
    const epRadius = params.entrancePupilRadius || 10.0;
    const bundle = SkewRayTracer.generateEntrancePupilRayGrid(epRadius, 0.5875618, 3, 8);
    const traced = SkewRayTracer.traceRayBundle(surfaces, bundle, 75.0);
    const spotData = SkewRayTracer.computeSpotDiagram(traced, 75.0);
    const mtfData = SkewRayTracer.computeMTFCurve(spotData.rmsRadiusMm, params.fStop || 1.4, 120);
    return { surfaces, spotData, mtfData, aperture: params.fStop || 1.4 };
  }, { domain: 'optics', description: 'Exact 3D vector Snell skew ray trace, spot diagram, and polychromatic MTF' });

  // 5. Evaluate Aspheric Freeform Optics
  defineHandler('omni:evaluate-aspheric-optics', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const asphere = new AsphericSurface(params);
    const sag = asphere.evaluateSag(params.r || 5.0);
    const normal = asphere.evaluateNormal(params.x || 3.0, params.y || 4.0);
    const ray = { origin: new Vector3(0, params.y || 4.0, -10.0), dir: new Vector3(0, 0, 1) };
    const hit = asphere.intersectRay(ray);
    return { success: true, sag, normal: normal.toArray(), hit: (hit && hit.hit && hit.point) ? { point: hit.point.toArray(), normal: hit.normal.toArray() } : null };
  }, { domain: 'optics', description: 'Evaluate high-order Even Asphere / Q-Type polynomials' });

  // 6. Evaluate Dielectric Thin-Film Coating
  defineHandler('omni:evaluate-thin-film-coating', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const coating = new DielectricThinFilm(params.substrateIndex || 1.5168);
    if (params.layers && params.layers.length > 0) {
      params.layers.forEach(l => coating.addLayer(l.n, l.thicknessNm));
    } else {
      coating.addLayer(1.38, 99.64);
      coating.addLayer(2.10, 65.48);
    }
    const res = coating.evaluate(params.wavelengthNm || 550.0, params.thetaDeg || 0.0);
    return { success: true, result: res };
  }, { domain: 'optics', description: 'Compute transfer matrix reflectance and transmission of optical coatings' });

  // 7. Optical Thermal Soak & CTE Expansion
  defineHandler('omni:evaluate-optical-thermal-soak', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const spec = params.lensSpec || {
      housingMaterial: 'ALUMINUM_6061',
      elements: [
        { radius1: 50.0, radius2: -100.0, thicknessMm: 8.0, glass: 'N-BK7', airGapMm: 2.0, refractiveIndex: 1.5168 }
      ]
    };
    const res = OpticalThermalSoakEngine.evaluateThermalSoak(spec, params.targetTempC || 60.0, params.refTempC || 20.0);
    return { success: true, result: res };
  }, { domain: 'optics', description: 'Athermalization analysis: dn/dT glass index shift and barrel thermal expansion' });

  // 8. 2D FFT Wavefront PSF & MTF
  defineHandler('omni:evaluate-wavefront-psf', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const res = DiffractionPSFMTFEngine.evaluateWavefrontPSFandMTF(params || { gridSize: 64, wavelengthUm: 0.55, fNumber: 2.8 });
    return { success: true, result: res };
  }, { domain: 'optics', description: 'Diffraction Point Spread Function and optical transfer function via 2D FFT' });

  // 9. Damped Least Squares (DLS) Optimizer
  defineHandler('omni:optimize-optical-dls', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const optimizer = new DampedLeastSquaresOptimizer(params.options || {});
    const system = params.system || {
      entrancePupilRadius: 10.0,
      targetEfl: 50.0,
      surfaces: [
        { radius: 50.0, thickness: 5.0, refractiveIndex: 1.5168 },
        { radius: -80.0, thickness: 48.0, refractiveIndex: 1.0 },
        { radius: 0.0, thickness: 0.0, refractiveIndex: 1.0 }
      ]
    };
    const variables = params.variables || [
      { surfaceIndex: 0, param: 'radius', min: 20.0, max: 100.0 }
    ];
    const operands = params.operands || [];
    const res = optimizer.optimize(system, variables, operands);
    return { success: true, ...res };
  }, { domain: 'optics', description: 'Levenberg-Marquardt DLS merit function optimization' });

  // 10. Zemax OpticStudio (.ZMX) Lens Prescription Import & Analysis
  defineHandler('omni:import-zmx-optics', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { content = '', filePath = '' } = params;
    let rawContent = content;
    if (!rawContent && filePath) {
      const fs = require('fs');
      if (fs.existsSync(filePath)) {
        rawContent = fs.readFileSync(filePath);
      }
    }
    const system = ZemaxZmxImporter.parse(rawContent);
    const paraxial = ZemaxZmxImporter.computeParaxialMetrics(system);
    return { success: true, system, paraxial };
  }, { domain: 'optics', description: 'Parse Zemax OpticStudio .zmx file into sequential optical model' });
}

module.exports = { registerOpticsIpc };
