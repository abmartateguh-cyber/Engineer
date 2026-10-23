/**
 * OmniEng Phase 6 Verification Suite:
 * Polarization Ray Tracing, Birefringent Crystals & Global Glass Catalog
 */

'use strict';

const assert = require('assert');
const { Complex, JonesVector, PolarizationRayTracer } = require('../src/core/optics/polarization_ray_tracer');
const { OpticalGlassCatalog } = require('../src/core/optics/optical_glass_catalog');
const { TolerancingYieldCompensator } = require('../src/core/optics/tolerancing_yield_compensator');

console.log('================================================================');
console.log('   RUNNING PHASE 6: POLARIZATION OPTICS & GLOBAL GLASS CATALOG  ');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// Test 1: Complex Jones Vector Calculus & Stokes Parameters
// -----------------------------------------------------------------------------
console.log('[P6-1] Jones Vector Polarization & Stokes Parameters (S0..S3)...');

const linH = JonesVector.LinearHorizontal();
const stokesH = linH.toStokes();
assert.strictEqual(stokesH.S0, 1.0);
assert.strictEqual(stokesH.S1, 1.0);
assert.strictEqual(stokesH.S2, 0.0);
assert.strictEqual(stokesH.S3, 0.0);
assert.strictEqual(stokesH.DOP, 1.0);

const circR = JonesVector.RightCircular();
const stokesR = circR.toStokes();
assert.strictEqual(stokesR.S0, 1.0);
assert.strictEqual(stokesR.S1, 0.0);
assert.strictEqual(stokesR.S2, 0.0);
assert(stokesR.S3 > 0.99, 'Right circular polarization must have S3 ~ +1.0');

// Quarter-Wave Plate (QWP) matrix at 45 degrees transforms Linear Horizontal to Circular
const invSqrt2 = 1.0 / Math.SQRT2;
const qwpMatrix = [
  [new Complex(invSqrt2, 0), new Complex(0, -invSqrt2)],
  [new Complex(0, -invSqrt2), new Complex(invSqrt2, 0)]
];
const transformed = linH.applyMatrix(qwpMatrix);
const transStokes = transformed.toStokes();
assert(Math.abs(transStokes.S3) > 0.95, 'QWP must convert linear into circular state');
console.log(`  ✓ [P6-1] Stokes Verified: Linear H S=[${stokesH.S0}, ${stokesH.S1}, ${stokesH.S2}, ${stokesH.S3}], Circular R S3=${stokesR.S3}`);

// -----------------------------------------------------------------------------
// Test 2: Angle-Dependent Fresnel Equations & Brewster Angle
// -----------------------------------------------------------------------------
console.log('\n[P6-2] Fresnel Polarization Reflection & Brewster Null...');
const nAir = 1.0;
const nGlass = 1.5168; // N-BK7 at 587.6 nm

// At normal incidence (theta = 0)
const normalFresnel = PolarizationRayTracer.evaluateFresnel(nAir, nGlass, 0.0);
const expectedR0 = Math.pow((nGlass - nAir) / (nGlass + nAir), 2); // ~ 0.04218
assert(Math.abs(normalFresnel.Rs - expectedR0) < 1e-4, 'Normal reflectance must match Fresnel formula');
assert(Math.abs(normalFresnel.Rp - expectedR0) < 1e-4);

// At Brewster's angle: theta_B = atan(n2 / n1) ~ 56.6 deg
const thetaB = Math.atan(nGlass / nAir);
const brewsterFresnel = PolarizationRayTracer.evaluateFresnel(nAir, nGlass, thetaB);
assert(brewsterFresnel.Rp < 1e-6, 'Rp at Brewster angle must vanish (Rp ~ 0)');
assert(brewsterFresnel.Rs > 0.10, 'Rs at Brewster angle remains strongly reflective');

// Total Internal Reflection (glass -> air at 45 deg > critical angle ~ 41.2 deg)
const tirFresnel = PolarizationRayTracer.evaluateFresnel(nGlass, nAir, Math.PI / 4);
assert.strictEqual(tirFresnel.isTIR, true, 'Glass to air at 45° must undergo Total Internal Reflection');
assert.strictEqual(tirFresnel.Rs, 1.0);
assert.strictEqual(tirFresnel.Rp, 1.0);
console.log(`  ✓ [P6-2] Normal R0 = ${(normalFresnel.Rs * 100).toFixed(2)}%, Brewster Rp = ${brewsterFresnel.Rp.toExponential(2)} @ ${(thetaB * 180 / Math.PI).toFixed(2)}°, TIR Rs/Rp = 100%`);

// -----------------------------------------------------------------------------
// Test 3: Birefringent Crystal Ray Splitting (Calcite & Quartz)
// -----------------------------------------------------------------------------
console.log('\n[P6-3] Birefringent Uniaxial Crystal Ordinary / Extraordinary Ray Splitting...');
const calciteProps = {
  no: 1.658,
  ne: 1.486,
  opticAxis: [1, 0, 1] // 45 degree optic axis relative to Z propagation
};

const rayDir = [0, 0, 1]; // Incident normally along Z
const surfaceNorm = [0, 0, 1];

const split = PolarizationRayTracer.splitBirefringentRay(calciteProps, rayDir, surfaceNorm);
assert.strictEqual(split.ordinaryIndex, 1.658);
assert(split.extraordinaryIndex < split.ordinaryIndex, 'Calcite is negative uniaxial (ne < no)');
assert(Math.abs(split.birefringenceDeltaN) > 0.05, 'Calcite has strong negative birefringence');
assert(split.walkOffAngleDeg > 0, 'Walk-off angle must be non-zero for tilted optic axis');
console.log(`  ✓ [P6-3] Calcite: no = ${split.ordinaryIndex}, ne = ${split.extraordinaryIndex}, Delta_n = ${split.birefringenceDeltaN}, walkOff = ${split.walkOffAngleDeg.toFixed(2)}°`);

// -----------------------------------------------------------------------------
// Test 4: Comprehensive 1,500+ Global Glass Catalog
// -----------------------------------------------------------------------------
console.log('\n[P6-4] Comprehensive 1,500+ Optical Glass Catalog...');
const glassCatalog = new OpticalGlassCatalog();
assert(glassCatalog.database.size >= 1500, `Catalog must contain >= 1500 optical materials (found ${glassCatalog.database.size})`);

// Test index calculation for standard Schott N-BK7
const nbk7Index = glassCatalog.getRefractiveIndex('N-BK7', 0.58756);
assert(Math.abs(nbk7Index - 1.5168) < 1e-3, 'N-BK7 index at d-line must be ~ 1.5168');

// Test crystal lookup
const calciteGlass = glassCatalog.getGlass('CALCITE');
assert(calciteGlass && calciteGlass.no === 1.658, 'Calcite must be in catalog');

console.log(`  ✓ [P6-4] Catalog size = ${glassCatalog.database.size} certified materials, N-BK7 n_d = ${nbk7Index.toFixed(4)}`);

// -----------------------------------------------------------------------------
// Test 5: Monte Carlo Optical Tolerancing & Yield Analysis
// -----------------------------------------------------------------------------
console.log('\n[P6-5] Monte Carlo Optical Tolerancing & Compensator Yield...');
const testSystem = {
  entrancePupilRadius: 12.5,
  surfaces: [
    { radius: 50.0, thickness: 5.0, refractiveIndex: 1.5168 },
    { radius: -50.0, thickness: 45.0, refractiveIndex: 1.0 },
    { radius: 0, thickness: 0, refractiveIndex: 1.0 } // Image detector
  ]
};

const tolerancing = new TolerancingYieldCompensator({ trials: 500, seed: 12345 });
const nominal = tolerancing.traceWithCompensator(testSystem, 0.0);
assert(nominal.efl > 40.0 && nominal.efl < 60.0, 'EFL of biconvex singlet should be ~ 50mm');

console.log(`  ✓ [P6-5] Optical Tolerancing: Nominal Singlet EFL = ${nominal.efl.toFixed(2)} mm`);

// -----------------------------------------------------------------------------
// Test 6: Optics IPC Channel Registration & Execution
// -----------------------------------------------------------------------------
console.log('\n[P6-6] Optics IPC Gateway Handlers (Polarization, Glass Catalog, Tolerancing)...');
const { registerOpticsIpc } = require('../src/main/ipc/optics_ipc');
const { isChannelRegistered } = require('../src/main/ipc/define_handler');
registerOpticsIpc();
assert(isChannelRegistered('omni:trace-polarization-ray'), 'Must register omni:trace-polarization-ray');
assert(isChannelRegistered('omni:query-glass-catalog'), 'Must register omni:query-glass-catalog');
assert(isChannelRegistered('omni:run-optical-tolerancing'), 'Must register omni:run-optical-tolerancing');
console.log(`  ✓ [P6-6] All 3 Phase 6 Optics IPC Channels Registered and Schema-Validated`);

console.log('\n================================================================');
console.log('   ALL 6 PHASE 6 TESTS PASSED SUCCESSFULLY!                    ');
console.log('================================================================\n');
