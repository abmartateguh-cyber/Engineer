'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AsmePipingStandards,
  ASME_MATERIAL_CATALOG,
  getMaterialPropertiesAtTemp,
  PipingBranchReinforcement,
  HydraulicTransientsJoukowsky
} = require('../src/core/plant/plant_engineering_master_api');

test('ASME Material Catalog & Allowable Stresses S(T)', () => {
  // Check A106-B at ambient and elevated temperature
  const a106Ambient = getMaterialPropertiesAtTemp('A106-B', 38);
  assert.equal(a106Ambient.allowableStressMPa, 138.0);
  assert.equal(a106Ambient.yieldStrengthMPa, 240.0);

  const a106Hot = getMaterialPropertiesAtTemp('A106-B', 400);
  assert.ok(a106Hot.allowableStressMPa < 110.0, 'Stress derates at 400 °C');

  // Check Cryogenic SS316L at -196 °C
  const ss316L = getMaterialPropertiesAtTemp('A312-TP316L', -196);
  assert.equal(ss316L.allowableStressMPa, 115.0);

  // Check Super Duplex 2507 high strength
  const sd2507 = getMaterialPropertiesAtTemp('A790-UNS-S32750', 38);
  assert.equal(sd2507.allowableStressMPa, 227.0);
  assert.equal(sd2507.yieldStrengthMPa, 550.0);

  // Temperature limit enforcement
  assert.throws(() => {
    getMaterialPropertiesAtTemp('A106-B', 500); // Exceeds maxTempC 427 °C
  }, /exceeds ASME Section II Part D maximum code limit/);
});

test('ASME B31.3 Minimum Wall Thickness & Schedule Selection', () => {
  const result = AsmePipingStandards.calculateAsmeB31_3({
    materialId: 'A106-B',
    designPressureBarg: 75.0,
    designTempC: 50.0,
    outsideDiameterMm: 610.0, // 24" pipe
    corrosionAllowanceMm: 3.0,
    millTolerancePercent: 12.5
  });

  assert.equal(result.standard, 'ASME B31.3');
  assert.ok(result.tPressureMm > 15.0 && result.tPressureMm < 18.0);
  assert.ok(result.tmRequiredMm > 18.0);
  assert.ok(result.tNominalReqMm > 21.5 && result.tNominalReqMm < 23.0);

  // Schedule selector picks appropriate schedule
  const selected = AsmePipingStandards.selectPipeSchedule('24', 'A106-B', 75.0, 50.0, 3.0);
  assert.equal(selected.nps, '24');
  assert.ok(['60', '80', '100'].includes(selected.selectedSchedule));
  assert.ok(selected.mawpBarg >= 75.0);
  assert.equal(selected.isCompliant, true);
});

test('ASME B31.1, B31.4, B31.8 & B31.12 Multi-Code Execution', () => {
  // B31.1 Power Piping
  const b31_1 = AsmePipingStandards.calculateAsmeB31_1({
    materialId: 'A335-P11',
    designPressureBarg: 45.0,
    designTempC: 400.0,
    outsideDiameterMm: 323.8
  });
  assert.equal(b31_1.standard, 'ASME B31.1');
  assert.ok(b31_1.tmRequiredMm > 0);

  // B31.4 Liquid Hydrocarbon Pipeline
  const b31_4 = AsmePipingStandards.calculateAsmeB31_4({
    materialId: 'API-5L-X65',
    designPressureBarg: 90.0,
    outsideDiameterMm: 508.0
  });
  assert.equal(b31_4.standard, 'ASME B31.4');
  assert.ok(b31_4.tPressureMm > 0);

  // B31.8 Gas Pipeline
  const b31_8 = AsmePipingStandards.calculateAsmeB31_8({
    materialId: 'API-5L-X65',
    designPressureBarg: 90.0,
    designTempC: 30.0,
    outsideDiameterMm: 610.0
  });
  assert.equal(b31_8.standard, 'ASME B31.8');
  assert.ok(b31_8.tPressureMm > 0);

  // B31.12 Hydrogen Piping with Hf embrittlement factor
  const b31_12 = AsmePipingStandards.calculateAsmeB31_12({
    materialId: 'A312-TP316L',
    designPressureBarg: 150.0,
    designTempC: 40.0,
    outsideDiameterMm: 114.3
  });
  assert.equal(b31_12.standard, 'ASME B31.12');
  assert.equal(b31_12.materialPerformanceFactorHf, 0.8);
});

test('ASME B31.3 Section 304.3.2 Branch Reinforcement', () => {
  const result = PipingBranchReinforcement.evaluateBranchReinforcement({
    materialId: 'A106-B',
    designPressureBarg: 60.0,
    designTempC: 60.0,
    headerOutsideDiameterMm: 610.0,
    headerNominalWallMm: 24.61,
    branchOutsideDiameterMm: 323.8,
    branchNominalWallMm: 14.27,
    branchAngleDeg: 90.0,
    corrosionAllowanceMm: 1.5
  });

  assert.ok(result.requiredAreaA1Mm2 > 0);
  assert.ok(result.headerExcessAreaA2Mm2 >= 0);
  assert.ok(result.totalAvailableAreaMm2 > 0);
  assert.equal(typeof result.isAdequate, 'boolean');
});

test('Hydraulic Transients & Joukowsky Water Hammer Analysis', () => {
  const hammer = HydraulicTransientsJoukowsky.analyzeWaterHammer({
    pipeLengthM: 1200.0,
    initialVelocityMS: 2.5,
    finalVelocityMS: 0.0,
    valveClosureTimeS: 0.8,
    steadyOperatingPressureBarg: 15.0,
    fluidDensityKgM3: 998.0,
    fluidBulkModulusGPa: 2.15,
    pipeElasticModulusGPa: 205.0,
    pipeInsideDiameterMm: 300.0,
    pipeWallThicknessMm: 10.31,
    pipeMawpBarg: 50.0
  });

  assert.ok(hammer.waveCelerityMS > 1000.0 && hammer.waveCelerityMS < 1450.0);
  assert.ok(hammer.joukowskySurgeBar > 20.0);
  assert.equal(hammer.closureClassification, 'Rapid Closure (tc <= 2L/c)');
  assert.ok(hammer.peakTransientPressureBarg > 35.0);
});
