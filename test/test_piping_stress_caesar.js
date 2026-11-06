/**
 * test/test_piping_stress_caesar.js
 * Verification suite for ASME B31.3 / B31J piping flexibility, SIFs, and CAESAR II parity.
 */

'use strict';

const assert = require('assert');
const {
  PipingFlexibilityCharacteristics,
  PipingStressEngine
} = require('../src/core/plant/piping_stress_caesar');
const { PipingSpecCatalog3D } = require('../src/core/plant/piping_spec_catalog_3d');
const { PCFExporter } = require('../src/core/plant/pcf_export');

console.log('[TEST] Running ASME B31.3 / CAESAR II Piping Stress Suite...');

// 1. Elbow Flexibility & SIFs Benchmark
// Case: NPS 6 Sch 40 Long Radius Elbow
// Do = 168.3 mm, t = 7.11 mm, R1 = 1.5 * Do = 252.45 mm
// r2 = (168.3 - 7.11) / 2 = 80.595 mm
// h = (t * R1) / (r2^2) = (7.11 * 252.45) / (80.595^2) = 1794.92 / 6495.55 = 0.27633
// k = 1.65 / h = 1.65 / 0.27633 = 5.971
// i_i = 0.9 / (h^(2/3)) = 0.9 / (0.27633^(2/3)) = 0.9 / 0.4243 = 2.121
// i_o = 0.75 / (h^(2/3)) = 0.75 / 0.4243 = 1.768
const elbowFactors = PipingFlexibilityCharacteristics.computeElbowFactors({
  t: 7.11,
  R1: 252.45,
  Do: 168.3,
  pressure: 0
});

assert(Math.abs(elbowFactors.h - 0.2763) < 0.005, `h expected ~0.2763, got ${elbowFactors.h}`);
assert(Math.abs(elbowFactors.k - 5.97) < 0.05, `k expected ~5.97, got ${elbowFactors.k}`);
assert(Math.abs(elbowFactors.i_i - 2.12) < 0.05, `i_i expected ~2.12, got ${elbowFactors.i_i}`);
assert(Math.abs(elbowFactors.i_o - 1.77) < 0.05, `i_o expected ~1.77, got ${elbowFactors.i_o}`);
console.log('  ✓ PASS: ASME B31.3 Elbow Flexibility & SIFs verified');

// 2. Expansion Loop Flexibility & Code Stresses
const stressEngine = new PipingStressEngine({ ambientTempC: 20 });
const loopResult = stressEngine.solveExpansionLoop({
  runLength_m: 60.0,
  offset_m: 6.0,
  Do_m: 0.1683,
  t_m: 0.00711,
  operatingTempC: 220.0,
  pressure_Pa: 2.0e6,
  Sc_Pa: 138e6,
  Sh_Pa: 138e6
});

assert(loopResult.thermalExpansion_mm > 100 && loopResult.thermalExpansion_mm < 200, 'Thermal expansion in expected range');
assert(loopResult.sustainedStress_MPa > 0, 'Sustained stress positive');
assert(loopResult.expansionStress_MPa > 0, 'Expansion stress positive');
assert(loopResult.allowableExpansion_MPa > loopResult.expansionStress_MPa, 'Expansion stress within allowables');
assert.strictEqual(loopResult.codeCompliance, true, 'Code compliance passes');
console.log(`  ✓ PASS: Expansion loop solved: DeltaL = ${loopResult.thermalExpansion_mm.toFixed(1)} mm, S_E = ${loopResult.expansionStress_MPa.toFixed(1)} MPa <= S_A = ${loopResult.allowableExpansion_MPa.toFixed(1)} MPa`);

// 3. API 610 Nozzle Load Checks
const nozzleCheckPass = stressEngine.checkNozzleLoadsAPI610({
  nps: '4',
  Fx: 1200,
  Fy: 1500,
  Fz: 800,
  Mx: 600,
  My: 700,
  Mz: 500
});
assert.strictEqual(nozzleCheckPass.pass, true, 'Nozzle within API 610 Table 5 limits');

const nozzleCheckFail = stressEngine.checkNozzleLoadsAPI610({
  nps: '4',
  Fx: 8000,
  Fy: 9000,
  Fz: 5000
});
assert.strictEqual(nozzleCheckFail.pass, false, 'Excessive nozzle load correctly flagged');
console.log('  ✓ PASS: API 610 Table 5 nozzle load checks verified');

// 4. MSS SP-58 Spring Hanger Selection
const spring = stressEngine.selectSpringHanger({
  operatingLoad_N: 15000,
  verticalTravel_mm: 18.5
});
assert.strictEqual(spring.type, 'Variable Effort Spring Hanger');
assert(spring.coldLoad_N > 0);
console.log(`  ✓ PASS: Spring hanger selected: ${spring.type}, Hot = ${spring.operatingLoad_N} N, Cold = ${spring.coldLoad_N} N`);

// 5. 3D ASME Piping Catalog and Mesh Generation
const pipe4 = PipingSpecCatalog3D.getPipeSpec('4', '40');
assert.strictEqual(pipe4.outsideDiameter_mm, 114.3);
assert.strictEqual(pipe4.wallThickness_mm, 6.02);

const flange4 = PipingSpecCatalog3D.getFlangeSpec('4', '150');
assert.strictEqual(flange4.outsideDiameter_mm, 228.6);
assert.strictEqual(flange4.boltCount, 8);

const spoolMesh = PipingSpecCatalog3D.generateStraightSpool3D({ nps: '4', schedule: '40', length_mm: 3000 });
assert.strictEqual(spoolMesh.vertexCount, 48);
assert(spoolMesh.mass_kg > 40 && spoolMesh.mass_kg < 60);
console.log('  ✓ PASS: 3D ASME catalog & parametric mesh generation verified');

// 6. ISOGEN PCF Document Export
const pcf = new PCFExporter({ pipelineRef: '10-P-101-CS150', isogenHeader: true }).exportPCF([
  {
    type: 'PIPE',
    nps: 100,
    ep1: { x: 0, y: 0, z: 0 },
    ep2: { x: 3000, y: 0, z: 0 },
    material: 'ASTM A106-B',
    skey: 'PIPE'
  },
  {
    type: 'ELBOW',
    nps: 100,
    ep1: { x: 3000, y: 0, z: 0 },
    ep2: { x: 3152.4, y: 152.4, z: 0 },
    cp: { x: 3152.4, y: 0, z: 0 },
    skey: 'EL90'
  }
]);

assert(pcf.includes('ISOGEN-FILES ISOGEN.FLS'));
assert(pcf.includes('PIPELINE-REFERENCE 10-P-101-CS150'));
assert(pcf.includes('ELBOW'));
assert(pcf.includes('CENTRE-POINT 3152.4 0 0'));
console.log('  ✓ PASS: ISOGEN PCF export validated');

console.log('[TEST] ASME B31.3 / CAESAR II Piping Suite: ALL 6 CHECKS PASSED CLEANLY.');
