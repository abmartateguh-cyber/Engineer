/**
 * ISO_10110_OPTICS_TOLERANCE - real lens-prescription evaluation of ISO 10110
 * surface-form callouts on a realistic Sellmeier singlet.
 *
 * WP-2 replaces the earlier plane-parallel plate OPD-only substitute with:
 *   - a realistic singlet prescription (explicit radii, thickness, N-BK7-like
 *     Sellmeier glass, clear aperture, wavelength);
 *   - ISO 10110 surface-form callouts (e.g. "3/5(2)" or user-supplied
 *     "3/A(B/C)") mapped to Zernike-form sag error using the evaluator's
 *     37-term orthonormal Zernike basis;
 *   - a full skew-ray trace of the perturbed system (production-verified
 *     sequential tracer extended to Zernike sag);
 *   - wavefront OPD across the pupil, Zernike decomposition, RMS WFE and
 *     Strehl (Maréchal) reporting.
 *
 * Production solver anchors:
 *   - SkewRayTracer (src/core/optics/skew_ray_tracer.js) for the nominal
 *     prescription and for exact sphere-equivalent perturbation checks;
 *   - OpticalMaterials Sellmeier index (src/core/optics/optical_materials.js)
 *     for the glass dispersion at the trace wavelength.
 */
'use strict';

const assert = require('assert');
const { SkewRayTracer } = require('../../../src/core/optics/skew_ray_tracer');
const {
  MAX_ZERNIKE_TERMS,
  parseIso10110Callout,
  createZernikeQuadratureGrid,
  synthesizeZernikeOpd,
  decomposeZernike,
  rmsWavefrontError,
  strehlRatio,
  zernikeModeByIndex,
  zernikeBasis,
  formatIso10110Callout,
  buildSingletSurfaces,
  generateCollimatedPupilRaysFromGrid,
  traceSequentialZernikeSystem,
  perturbSurfaceWithZernikeSag,
  mapIso10110SurfaceFormCallout,
  evaluateIso10110SurfaceForm,
  ISO10110_SINGLET_PRESCRIPTION
} = require('../../../src/core/optics/iso10110_tolerance_evaluator');

const WAVELENGTH_UM = ISO10110_SINGLET_PRESCRIPTION.wavelengthUm;
const PUPIL_RADIUS_MM = ISO10110_SINGLET_PRESCRIPTION.entrancePupilRadiusMm;
const PUPIL_PLANE_Z_MM = ISO10110_SINGLET_PRESCRIPTION.pupilPlaneZMm;
const PLANE_Z_MM = ISO10110_SINGLET_PRESCRIPTION.centerThicknessMm;

/**
 * Exact sphere+polynomial representation of a rotationally symmetric Zernike
 * sag mode (4 = defocus/power, 9 = primary spherical) on a surface. Used to
 * verify the evaluator's Zernike-sag tracer against the production skew-ray
 * tracer, which supports sphere + conic + polynomial (A4..A10) surfaces.
 */
function equivalentSphericalSurface(surface, amplitudeMm, mode) {
  const r0 = surface.clearRadius;
  const cBase = 1 / surface.radius;
  const sqrtNorm = mode === 4 ? Math.sqrt(3) : Math.sqrt(5);
  let b1;
  let b2;
  let konst;
  if (mode === 4) {
    b1 = (2 * amplitudeMm * sqrtNorm) / (r0 * r0);
    b2 = 0;
    konst = -amplitudeMm * sqrtNorm;
  } else if (mode === 9) {
    b1 = (-6 * amplitudeMm * sqrtNorm) / (r0 * r0);
    b2 = (6 * amplitudeMm * sqrtNorm) / r0 ** 4;
    konst = amplitudeMm * sqrtNorm;
  } else {
    throw new Error(`equivalentSphericalSurface supports modes 4 and 9, got ${mode}.`);
  }
  const cNew = cBase + 2 * b1;
  const A4 = b2 + (cBase ** 3 - cNew ** 3) / 8;
  const A6 = (cBase ** 5 - cNew ** 5) / 16;
  const A8 = (5 * (cBase ** 7 - cNew ** 7)) / 128;
  const A10 = (7 * (cBase ** 9 - cNew ** 9)) / 256;
  return {
    radius: 1 / cNew,
    zVertex: surface.zVertex + konst,
    clearRadius: surface.clearRadius,
    nIncident: surface.nIncident,
    nTransmitted: surface.nTransmitted,
    conic: 0,
    asphericCoeffs: [A4, A6, A8, A10]
  };
}

function productionSurfaces(surfaces, frontOverride) {
  const toProd = (s) => ({
    radius: s.radius,
    zVertex: s.zVertex,
    clearRadius: s.clearRadius,
    nIncident: s.nIncident,
    nTransmitted: s.nTransmitted,
    conic: s.conic,
    asphericCoeffs: [...s.asphericCoeffs]
  });
  const out = [toProd(surfaces[0]), toProd(surfaces[1])];
  if (frontOverride) out[0] = frontOverride;
  return out;
}

function productionRays(rays) {
  return rays.map((r) => ({ ...r, wavelengthUm: WAVELENGTH_UM, intensity: 1 }));
}

/**
 * Main WP-2 check: realistic singlet + ISO 10110 surface-form callout +
 * Zernike sag perturbation + trace + OPD decomposition + RMS WFE / Strehl.
 * Reports the small-aberration manufacturing case and embeds the honest-fail
 * cases (callouts whose defect budget cannot meet the target Strehl).
 */
function runIso10110OpticsTolerance() {
  const targetStrehl = 0.8;

  const smallCase = evaluateIso10110SurfaceForm({ callout: '3/0.200(9)', targetStrehl });
  assert.strictEqual(smallCase.passed, true, 'small-aberration manufacturing case must pass');
  assert(smallCase.measured.deltaStrehl > targetStrehl, 'delta Strehl must exceed 0.80');
  assert(smallCase.measured.deltaRmsWaves < 0.05, 'defect wavefront must be a small aberration (< 0.05 lambda)');
  assert.strictEqual(
    smallCase.measured.activeRayCount,
    smallCase.measured.rayCount,
    'all pupil rays must reach the reference plane'
  );
  const modes = smallCase.measured.topDeltaCoefficients.map((c) => c.mode);
  assert(modes.includes(9), 'injected fringe mode 9 (primary spherical) must appear in the delta decomposition');

  const largeCase = evaluateIso10110SurfaceForm({ callout: '3/1.500(9)', targetStrehl });
  assert.strictEqual(largeCase.passed, false, 'large defect case must be reported honestly as failed');
  assert(largeCase.measured.deltaStrehl < targetStrehl, 'large defect Strehl must be below the target');

  const tiltCase = evaluateIso10110SurfaceForm({ callout: '3/5(2)', targetStrehl });
  assert.strictEqual(tiltCase.passed, false, 'callout 3/5(2) (5 um tilt) must fail honestly');

  const honestFailCases = [largeCase, tiltCase].map((case_) => ({
    callout: case_.details.mapping.parsed.text,
    deltaRmsWaves: case_.measured.deltaRmsWaves,
    deltaStrehl: case_.measured.deltaStrehl,
    status: case_.status
  }));

  return {
    id: 'ISO10110_SINGLET_SURFACE_FORM',
    name:
      'Real singlet prescription (Sellmeier), ISO 10110 surface-form callout ' +
      `"3/0.200(9)" -> Zernike sag perturbation, skew-ray trace, OPD decomposition, RMS WFE + Strehl`,
    targetValue: targetStrehl,
    calculatedValue: smallCase.measured.deltaStrehl,
    units: 'Strehl (unitless)',
    errorPercent: undefined,
    tolerancePercent: undefined,
    passed: smallCase.passed,
    status: smallCase.status,
    reason: smallCase.reason,
    measured: smallCase.measured,
    expected: {
      deltaStrehl: `>= ${targetStrehl} for the small-aberration manufacturing case`,
      deltaRmsWaves: '< 0.05 lambda (small aberration assumption)',
      honestFailReporting: 'cases that cannot meet the threshold report status "failed"'
    },
    details: {
      reference: 'ISO 10110-5 surface form; callout 3/A(B/C) -> Zernike sag RMS amplitude A (um), modes B/C',
      solver: 'src/core/optics/iso10110_tolerance_evaluator.js (Zernike-sag sequential ray trace, production-verified)',
      setup: smallCase.details.setup,
      mapping: smallCase.details.mapping,
      honestFailCases
    }
  };
}

/**
 * Production skew-ray tracer equivalence: the evaluator's Zernike-sag tracer
 * must reproduce the production SkewRayTracer exactly for (a) the nominal
 * singlet and (b) an ISO power callout realized as an exact sphere radius
 * change; and within the production tracer's aspheric-normal approximation for
 * (c) a primary-spherical callout realized as sphere + polynomial.
 */
function runIso10110ProductionTracerEquivalence() {
  const { surfaces } = buildSingletSurfaces(WAVELENGTH_UM);
  const grid = createZernikeQuadratureGrid();
  const rays = generateCollimatedPupilRaysFromGrid(PUPIL_RADIUS_MM, grid, WAVELENGTH_UM, PUPIL_PLANE_Z_MM);

  const tracedOursNom = traceSequentialZernikeSystem(
    surfaces,
    rays.map((r) => ({ ...r, path: [] })),
    { planeZ: PLANE_Z_MM }
  );
  const tracedProdNom = SkewRayTracer.traceOpticalSystem(
    productionSurfaces(surfaces),
    productionRays(rays),
    PLANE_Z_MM
  );

  const maxOplDiffNominal = maxOplDiff(tracedOursNom, tracedProdNom);
  assert(maxOplDiffNominal < 1e-9, `nominal OPL mismatch ${maxOplDiffNominal} >= 1e-9 mm`);

  const mode4AmpMm = 0.00015;
  const cf4 = new Array(MAX_ZERNIKE_TERMS).fill(0);
  cf4[3] = mode4AmpMm;
  const perturbed4 = perturbSurfaceWithZernikeSag(surfaces, cf4, { surfaceIndex: 0 });
  const tracedOurs4 = traceSequentialZernikeSystem(
    perturbed4,
    rays.map((r) => ({ ...r, path: [] })),
    { planeZ: PLANE_Z_MM }
  );
  const prodSurfaces4 = productionSurfaces(surfaces, equivalentSphericalSurface(surfaces[0], mode4AmpMm, 4));
  const tracedProd4 = SkewRayTracer.traceOpticalSystem(prodSurfaces4, productionRays(rays), PLANE_Z_MM);
  const maxOplDiffMode4 = maxOplDiff(tracedOurs4, tracedProd4);
  assert(maxOplDiffMode4 < 1e-6, `power-equivalent OPL mismatch ${maxOplDiffMode4} >= 1e-6 mm`);

  const mode9AmpMm = 0.0002;
  const cf9 = new Array(MAX_ZERNIKE_TERMS).fill(0);
  cf9[8] = mode9AmpMm;
  const perturbed9 = perturbSurfaceWithZernikeSag(surfaces, cf9, { surfaceIndex: 0 });
  const tracedOurs9 = traceSequentialZernikeSystem(
    perturbed9,
    rays.map((r) => ({ ...r, path: [] })),
    { planeZ: PLANE_Z_MM }
  );
  const prodSurfaces9 = productionSurfaces(surfaces, equivalentSphericalSurface(surfaces[0], mode9AmpMm, 9));
  const tracedProd9 = SkewRayTracer.traceOpticalSystem(prodSurfaces9, productionRays(rays), PLANE_Z_MM);
  const maxOplDiffMode9 = maxOplDiff(tracedOurs9, tracedProd9);
  assert(maxOplDiffMode9 < 1e-5, `spherical-equivalent OPL mismatch ${maxOplDiffMode9} >= 1e-5 mm`);

  const passed = true;
  return {
    id: 'ISO10110_PRODUCTION_TRACER_EQUIVALENCE',
    name: 'Evaluator Zernike-sag tracer equivalence to production SkewRayTracer (nominal, power, spherical)',
    targetValue: undefined,
    calculatedValue: maxOplDiffMode9,
    units: 'mm (OPL)',
    errorPercent: undefined,
    tolerancePercent: undefined,
    passed,
    status: 'passed',
    reason: undefined,
    measured: {
      maxOplDiffNominalMm: maxOplDiffNominal,
      maxOplDiffPowerMode4Mm: maxOplDiffMode4,
      maxOplDiffSphericalMode9Mm: maxOplDiffMode9,
      rayCount: rays.length
    },
    expected: {
      nominal: '<= 1e-9 mm',
      powerMode4: '<= 1e-6 mm (production tracer exact for sphere-equivalent)',
      sphericalMode9: '<= 1e-5 mm (production tracer sphere-normal approximation for aspherics)'
    },
    details: {
      reference: 'Production SkewRayTracer (src/core/optics/skew_ray_tracer.js)',
      solver: 'src/core/optics/iso10110_tolerance_evaluator.js (Zernike-sag tracer)',
      setup: {
        wavelengthUm: WAVELENGTH_UM,
        prescription: {
          radiusFrontMm: ISO10110_SINGLET_PRESCRIPTION.radiusFrontMm,
          radiusRearMm: ISO10110_SINGLET_PRESCRIPTION.radiusRearMm,
          centerThicknessMm: ISO10110_SINGLET_PRESCRIPTION.centerThicknessMm,
          clearApertureMm: ISO10110_SINGLET_PRESCRIPTION.clearApertureMm
        },
        powerPerturbationUm: mode4AmpMm * 1000,
        sphericalPerturbationUm: mode9AmpMm * 1000,
        quadratureGrid: `${grid.radialPoints} radial x ${grid.angularPoints} angular`
      }
    }
  };
}

function maxOplDiff(a, b) {
  assert.strictEqual(a.length, b.length, 'traced ray counts must match');
  let maxDiff = 0;
  for (let i = 0; i < a.length; i++) {
    assert.strictEqual(a[i].isTerminated, b[i].isTerminated, `ray ${i} termination state must match`);
    if (!a[i].isTerminated) {
      maxDiff = Math.max(maxDiff, Math.abs(a[i].opl - b[i].opl));
    }
  }
  return maxDiff;
}

/**
 * Evaluator-based checks (ISO 10110 callout parser + 37-term Zernike modal
 * decomposition + Strehl). Asserts run inside; the returned object reports
 * measured values and pass/fail.
 */
function runIso10110ZernikeEvaluator() {
  const measured = {};

  // -- 1. ISO 10110 callout parsing -------------------------------------
  const calloutA = parseIso10110Callout('3/A(B/C)');
  assert.strictEqual(calloutA.section, 3);
  assert.strictEqual(calloutA.value, 'A');
  assert.deepStrictEqual(calloutA.params, ['B', 'C']);
  assert.strictEqual(formatIso10110Callout(calloutA), '3/A(B/C)');

  const calloutSigma = parseIso10110Callout('4/σ');
  assert.strictEqual(calloutSigma.section, 4);
  assert.strictEqual(calloutSigma.value, 'σ');
  assert.deepStrictEqual(calloutSigma.params, []);

  const callout13 = parseIso10110Callout('13/25(1064/1.5)');
  assert.strictEqual(callout13.section, 13);
  assert.strictEqual(callout13.value, '25');
  assert.deepStrictEqual(callout13.params, ['1064', '1.5']);

  const malformed = ['', '3', '3/', '3/A(', '3/A(B', '3/(B/C)', 'x/5', '3/5/6', '3/A()', '3/A(B/C))', '3/A B'];
  for (const bad of malformed) {
    assert.throws(() => parseIso10110Callout(bad), Error, `expected rejection of callout "${bad}"`);
  }
  measured.calloutChecks = '3/A(B/C), 4/σ, 13/25(1064/1.5) parsed; 11 malformed callouts rejected';

  // -- 1b. Surface-form callout mapping (section 3) ----------------------
  const mapped = mapIso10110SurfaceFormCallout('3/0.200(9)');
  assert.strictEqual(mapped.amplitudeUm, 0.2);
  assert.deepStrictEqual(mapped.modes, [9]);
  assert.strictEqual(mapped.coefficients[8], 0.0002);
  const mappedStandard = mapIso10110SurfaceFormCallout('3/0.1(5/standard)');
  assert.strictEqual(mappedStandard.indexing, 'standard');
  assert.deepStrictEqual(mappedStandard.modes, [5]);
  assert.throws(() => mapIso10110SurfaceFormCallout('3/0.1(0)'), Error, 'mode 0 must be rejected');
  assert.throws(() => mapIso10110SurfaceFormCallout('3/0.1(38)'), Error, 'mode 38 must be rejected');
  assert.throws(() => mapIso10110SurfaceFormCallout('3/-1(9)'), Error, 'negative amplitude must be rejected');
  assert.throws(() => mapIso10110SurfaceFormCallout('5/0.1(9)'), Error, 'non-section-3 callout must be rejected');

  // -- 2. 37-term Zernike basis structure --------------------------------
  const fringeBasis = zernikeBasis({ indexing: 'fringe' });
  const standardBasis = zernikeBasis({ indexing: 'standard' });
  assert.strictEqual(fringeBasis.length, MAX_ZERNIKE_TERMS);
  assert.strictEqual(standardBasis.length, MAX_ZERNIKE_TERMS);
  assert.deepStrictEqual(zernikeModeByIndex(1), { j: 1, n: 0, m: 0 });
  assert.deepStrictEqual(zernikeModeByIndex(4), { j: 4, n: 2, m: 0 });
  assert.deepStrictEqual(zernikeModeByIndex(9), { j: 9, n: 4, m: 0 });
  assert.deepStrictEqual(zernikeModeByIndex(1, { indexing: 'standard' }), { j: 1, n: 0, m: 0 });

  // -- 3. Manufactured OPD -> coefficient recovery ------------------------
  const manufactured = new Array(MAX_ZERNIKE_TERMS).fill(0);
  manufactured[3] = 0.025; // fringe 4: defocus
  manufactured[4] = 0.02; // fringe 5: astigmatism 0 deg
  manufactured[6] = 0.01; // fringe 7: coma y
  manufactured[8] = 0.008; // fringe 9: primary spherical
  manufactured[15] = 0.005; // fringe 16: secondary spherical
  manufactured[25] = 0.003; // fringe 26: (8,2) term

  const grid = createZernikeQuadratureGrid();
  const opd = synthesizeZernikeOpd(manufactured, grid);
  const recovered = decomposeZernike(opd, grid);

  let maxCoeffError = 0;
  for (let j = 0; j < MAX_ZERNIKE_TERMS; j++) {
    maxCoeffError = Math.max(maxCoeffError, Math.abs(recovered[j] - manufactured[j]));
  }
  assert(maxCoeffError < 1e-9, `recovered Zernike coefficients deviate by ${maxCoeffError} (> 1e-9)`);

  // General least-squares path (deterministic pseudo-random points in disk).
  const rng = mulberry32(20261031);
  const nPts = 300;
  const xs = [];
  const ys = [];
  while (xs.length < nPts) {
    const x = 2 * rng() - 1;
    const y = 2 * rng() - 1;
    if (x * x + y * y <= 1) {
      xs.push(x);
      ys.push(y);
    }
  }
  const randomOpd = synthesizeZernikeOpd(manufactured, { x: xs, y: ys });
  const recoveredLsq = decomposeZernike(randomOpd, { x: xs, y: ys });
  let maxCoeffErrorLsq = 0;
  for (let j = 0; j < MAX_ZERNIKE_TERMS; j++) {
    maxCoeffErrorLsq = Math.max(maxCoeffErrorLsq, Math.abs(recoveredLsq[j] - manufactured[j]));
  }
  assert(maxCoeffErrorLsq < 1e-6, `least-squares recovery deviates by ${maxCoeffErrorLsq} (> 1e-6)`);

  measured.sampleGrid = { radialPoints: grid.radialPoints, angularPoints: grid.angularPoints, points: grid.x.length };
  measured.maxCoeffErrorQuadrature = maxCoeffError;
  measured.maxCoeffErrorLeastSquares = maxCoeffErrorLsq;

  // -- 4. RMS wavefront error --------------------------------------------
  const rmsWfe = rmsWavefrontError(recovered);
  assert(Number.isFinite(rmsWfe), 'RMSWFE must be finite');
  assert(rmsWfe > 0, 'RMSWFE must be positive for a non-zero aberration set');
  measured.rmsWfeUm = rmsWfe;

  // -- 5. Strehl ratio (Maréchal approximation) ---------------------------
  const wavelengthUm = 0.55;
  const strehl = strehlRatio(rmsWfe, { wavelength: wavelengthUm });
  assert(strehl > 0.8, `Strehl ${strehl} must exceed 0.80 for a small aberration case`);
  measured.strehl = strehl;
  measured.rmsWaves = rmsWfe / wavelengthUm;

  const passed = true;
  return {
    id: 'ISO10110_ZERNIKE_EVALUATOR',
    name: 'ISO 10110 callout parsing + 37-term Zernike modal decomposition + Strehl evaluation',
    targetValue: undefined,
    calculatedValue: maxCoeffError,
    units: 'coefficient error (unitless)',
    errorPercent: undefined,
    tolerancePercent: undefined,
    passed,
    status: 'passed',
    reason: undefined,
    measured,
    expected: {
      maxCoeffError: '<= 1e-9 (quadrature projection) and <= 1e-6 (least squares)',
      rmsWfeUm: '> 0, finite',
      strehl: '> 0.80 for small aberration case',
      calloutParser: 'rejects malformed callouts',
      surfaceFormMapping: 'section 3 mapping, mode bounds, amplitude validation'
    },
    details: {
      reference: 'ISO 10110 drawing notation; Maréchal Strehl approximation exp(-(2π·RMSWFE/λ)^2)',
      solver: 'src/core/optics/iso10110_tolerance_evaluator.js (quadrature projection + Householder QR least squares)',
      setup: {
        callouts: ['3/A(B/C)', '4/σ', '13/25(1064/1.5)'],
        manufacturedCoefficients: {
          defocus: 0.025,
          astigmatism: 0.02,
          comaY: 0.01,
          spherical: 0.008,
          secondarySpherical: 0.005,
          mode26: 0.003
        },
        quadratureGrid: '21 Gauss-Legendre radial x 32 angular points (exact to Zernike degree 10)',
        wavelengthUm
      }
    }
  };
}

/** Deterministic PRNG (mulberry32) for the least-squares sampling check. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { runIso10110OpticsTolerance, runIso10110ProductionTracerEquivalence, runIso10110ZernikeEvaluator };

if (require.main === module) {
  const checks = [
    runIso10110OpticsTolerance(),
    runIso10110ProductionTracerEquivalence(),
    runIso10110ZernikeEvaluator()
  ];
  let passed = 0;
  for (const check of checks) {
    const state = check.passed ? 'PASS' : 'FAIL';
    console.log(`[${state}] ${check.id}: ${check.name}`);
    if (!check.passed && check.reason) console.log(`  reason: ${check.reason}`);
    passed += check.passed ? 1 : 0;
  }

  const main = checks[0];
  console.log('\nISO 10110 tolerance VV: ' + `${passed}/${checks.length} checks passed`);
  console.log('Singlet surface-form (callout 3/0.200(9), small-aberration manufacturing case):');
  console.log(
    `  delta RMS WFE = ${main.measured.deltaRmsWfeUm.toFixed(5)} um (${main.measured.deltaRmsWaves.toFixed(5)} lambda)`
  );
  console.log(`  delta Strehl  = ${main.measured.deltaStrehl.toFixed(5)} (target > 0.80)`);
  console.log(`  absolute (nominal best-focus) Strehl = ${main.measured.absoluteStrehl.toFixed(5)}`);
  console.log(`  refocused Strehl = ${main.measured.refocusedStrehl.toFixed(5)}`);
  console.log(`  nominal singlet Strehl = ${main.measured.nominalStrehl.toFixed(5)}`);
  for (const failCase of main.details.honestFailCases) {
    console.log(
      `  honest-fail ${failCase.callout}: delta Strehl = ${failCase.deltaStrehl.toFixed(5)} (status ${failCase.status})`
    );
  }
  const eq = checks[1];
  console.log('Production tracer equivalence:');
  console.log(`  nominal max|dOPL| = ${eq.measured.maxOplDiffNominalMm.toExponential(3)} mm`);
  console.log(`  power (mode 4) max|dOPL| = ${eq.measured.maxOplDiffPowerMode4Mm.toExponential(3)} mm`);
  console.log(`  spherical (mode 9) max|dOPL| = ${eq.measured.maxOplDiffSphericalMode9Mm.toExponential(3)} mm`);
  const ev = checks[2];
  console.log('Evaluator:');
  console.log(
    `  maxCoeffErr(quadrature)=${ev.measured.maxCoeffErrorQuadrature.toExponential(3)}, ` +
      `maxCoeffErr(LSQ)=${ev.measured.maxCoeffErrorLeastSquares.toExponential(3)}, ` +
      `RMSWFE=${ev.measured.rmsWfeUm.toFixed(5)} um, Strehl=${ev.measured.strehl.toFixed(4)}`
  );
  process.exitCode = passed === checks.length ? 0 : 1;
}
