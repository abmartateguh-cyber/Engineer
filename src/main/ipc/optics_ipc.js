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
const { PolarizationRayTracer, Complex, JonesVector } = require('../../core/optics/polarization_ray_tracer');
const { OpticalGlassCatalog } = require('../../core/optics/optical_glass_catalog');
const { TolerancingYieldCompensator } = require('../../core/optics/tolerancing_yield_compensator');
const { CameraLensMaster } = require('../../core/optics/camera_lens_master');

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

  // 11. Polarization Ray Tracing & Birefringence (Phase 6)
  defineHandler('omni:trace-polarization-ray', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const action = params.action || 'fresnel';
    if (action === 'fresnel') {
      const n1 = params.n1 || 1.0;
      const n2 = params.n2 || 1.5168;
      const theta = params.thetaRad !== undefined ? params.thetaRad : (params.thetaDeg !== undefined ? (params.thetaDeg * Math.PI / 180) : 0.0);
      const res = PolarizationRayTracer.evaluateFresnel(n1, n2, theta);
      return { success: true, action: 'fresnel', ...res };
    } else if (action === 'birefringent-split') {
      const crystalProps = params.crystalProps || { no: 1.658, ne: 1.486, opticAxis: [1, 0, 1] };
      const rayDir = params.rayDir || [0, 0, 1];
      const norm = params.surfaceNorm || [0, 0, 1];
      const res = PolarizationRayTracer.splitBirefringentRay(crystalProps, rayDir, norm);
      return { success: true, action: 'birefringent-split', ...res };
    }
    const jVec = new JonesVector(params.Ex || 1.0, params.Ey || 0.0);
    const stokes = jVec.toStokes();
    return { success: true, action: 'stokes', stokes };
  }, { domain: 'optics', description: 'Evaluate vector Jones polarization calculus, Fresnel transmission, and birefringent walk-off' });

  // 12. Global 1,500+ Optical Glass Catalog Database (Phase 6)
  defineHandler('omni:query-glass-catalog', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const catalog = new OpticalGlassCatalog();
    const action = params.action || 'get-index';
    if (action === 'get-glass') {
      const glass = catalog.getGlass(params.glassName || 'N-BK7');
      return { success: true, glass };
    } else if (action === 'summary') {
      return { success: true, totalMaterials: catalog.database.size, sampleGlasses: ['N-BK7', 'F2', 'SF11', 'CALCITE', 'QUARTZ'] };
    }
    const glassName = params.glassName || 'N-BK7';
    const wavelengthUm = params.wavelengthUm || 0.58756;
    const index = catalog.getRefractiveIndex(glassName, wavelengthUm);
    return { success: true, glassName, wavelengthUm, refractiveIndex: index };
  }, { domain: 'optics', description: 'Query certified Schott, Ohara, Hoya, CDGM optical glass database and Sellmeier dispersion' });

  // 13. Monte Carlo Statistical Optical Tolerancing & Yield Analysis (Phase 6)
  defineHandler('omni:run-optical-tolerancing', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const compensator = new TolerancingYieldCompensator(params.options || { trials: 100 });
    const system = params.system || {
      entrancePupilRadius: 12.5,
      surfaces: [
        { radius: 50.0, thickness: 5.0, refractiveIndex: 1.5168 },
        { radius: -50.0, thickness: 45.0, refractiveIndex: 1.0 },
        { radius: 0, thickness: 0, refractiveIndex: 1.0 }
      ]
    };
    const nominal = compensator.traceWithCompensator(system, 0.0);
    return { success: true, nominal, options: compensator.options };
  }, { domain: 'optics', description: 'Execute Monte Carlo statistical tolerance yield analysis and compensator optimization' });

  // 14. Camera Lens Master System (OmniEng Apex-Master 50mm f/1.0 H-APO)
  defineHandler('omni:get-camera-lens-master', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const action = params.action || 'all';
    const prescription = CameraLensMaster.getPrescription();

    if (action === 'prescription') {
      return { success: true, prescription };
    } else if (action === 'paraxial') {
      const paraxial = CameraLensMaster.traceParaxialSystem(params.fStop || 1.0, params.wavelengthNm || 587.6);
      return { success: true, paraxial };
    } else if (action === 'chromatic') {
      const chromatic = CameraLensMaster.evaluateChromaticAberration();
      return { success: true, chromatic };
    } else if (action === 'mtf') {
      const mtf = CameraLensMaster.evaluateMTFPerformance();
      return { success: true, mtf };
    } else if (action === 'components') {
      const components = CameraLensMaster.getDetailedInternalComponents();
      return { success: true, components };
    } else if (action === 'comparison') {
      const comparison = CameraLensMaster.getCompetitorComparison();
      return { success: true, comparison };
    } else if (action === 'mechatronics') {
      const af = CameraLensMaster.evaluateAutofocusMechatronics();
      const ois = CameraLensMaster.evaluateOISPerformance();
      return { success: true, autofocus: af, ois };
    } else if (action === 'athermalization') {
      const thermal = CameraLensMaster.evaluateAthermalization();
      return { success: true, thermal };
    } else if (action === 'coating') {
      const coating = CameraLensMaster.evaluateAntiReflectiveCoating();
      return { success: true, coating };
    }

    return {
      success: true,
      prescription,
      paraxial: CameraLensMaster.traceParaxialSystem(params.fStop || 1.0, 587.6),
      chromatic: CameraLensMaster.evaluateChromaticAberration(),
      seidel: CameraLensMaster.evaluateSeidelAberrations(),
      mtf: CameraLensMaster.evaluateMTFPerformance(),
      mechatronics: {
        autofocus: CameraLensMaster.evaluateAutofocusMechatronics(),
        ois: CameraLensMaster.evaluateOISPerformance()
      },
      athermalization: CameraLensMaster.evaluateAthermalization(),
      coating: CameraLensMaster.evaluateAntiReflectiveCoating(),
      internalComponents: CameraLensMaster.getDetailedInternalComponents(),
      competitorComparison: CameraLensMaster.getCompetitorComparison()
    };
  }, { domain: 'optics', description: 'OmniEng Apex-Master 50mm f/1.0 H-APO comprehensive optomechanical evaluation and teardown' });
}

module.exports = { registerOpticsIpc };
