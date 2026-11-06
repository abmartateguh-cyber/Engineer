'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PumpCentrifugalApi610 } = require('../src/core/plant/rotating/pump_centrifugal_api610');
const { PumpHydraulicAnalysis } = require('../src/core/plant/rotating/pump_hydraulic_analysis');
const { PumpPositiveDisplacement } = require('../src/core/plant/rotating/pump_positive_displacement');

test('PumpCentrifugalApi610: Operating Point, Specific Speeds & Driver Margins', () => {
  // Test Case 1: Hydrocarbon transfer pump (OH2)
  const pumpResult = PumpCentrifugalApi610.evaluatePumpOperatingPoint({
    flowRateM3H: 350.0,
    differentialHeadM: 120.0,
    liquidDensityKgM3: 820.0,
    speedRpm: 2950,
    bepEfficiency: 0.81,
    npshrAtBepM: 3.5,
    apiType: 'OH2'
  });

  assert.strictEqual(pumpResult.api610Type, 'OH2');
  assert.ok(pumpResult.hydraulicPowerKW > 90.0, 'Hydraulic power should be > 90 kW');
  assert.ok(pumpResult.shaftPowerKW > pumpResult.hydraulicPowerKW, 'Shaft power must account for efficiency');
  assert.strictEqual(pumpResult.api610DriverMarginPct, 10.0, 'Driver margin for > 55 kW must be 10% per API 610 Table 14');
  assert.ok(pumpResult.recommendedDriverKW > pumpResult.shaftPowerKW);
  assert.ok(pumpResult.specificSpeedNs_US > 500 && pumpResult.specificSpeedNs_US < 4000, 'Specific speed within centrifugal radial range');
  assert.strictEqual(typeof pumpResult.isHighSuctionEnergyPump, 'boolean');

  // Test Case 2: Small utility pump (< 22 kW -> 25% margin)
  const smallPump = PumpCentrifugalApi610.evaluatePumpOperatingPoint({
    flowRateM3H: 25.0,
    differentialHeadM: 40.0,
    liquidDensityKgM3: 1000.0,
    speedRpm: 1450,
    bepEfficiency: 0.70,
    npshrAtBepM: 2.0,
    apiType: 'OH1'
  });
  assert.strictEqual(smallPump.api610DriverMarginPct, 25.0, 'Driver margin for < 22 kW must be 25% per API 610 Table 14');
});

test('PumpCentrifugalApi610: Affinity Laws for Speed Scaling & Impeller Trimming', () => {
  const baseline = {
    flowM3H: 200.0,
    headM: 80.0,
    powerKW: 50.0,
    diameterMm: 320.0,
    speedRpm: 2950
  };

  // Speed change from 2950 to 1475 rpm (50% speed)
  const speedScaled = PumpCentrifugalApi610.applyAffinityLaws(baseline, 320.0, 1475);
  assert.strictEqual(speedScaled.scaledFlowM3H, 100.0, 'Flow scales linearly with speed: Q2 = Q1 * (N2/N1)');
  assert.strictEqual(speedScaled.scaledHeadM, 20.0, 'Head scales quadratically with speed: H2 = H1 * (N2/N1)^2');
  assert.strictEqual(speedScaled.scaledPowerKW, 6.3, 'Power scales cubically with speed: P2 = P1 * (N2/N1)^3');

  // Impeller trim by 5% (320 mm to 304 mm)
  const trimmed = PumpCentrifugalApi610.applyAffinityLaws(baseline, 304.0, 2950);
  assert.strictEqual(trimmed.diameterTrimPercent, 5.0);
  assert.strictEqual(trimmed.isTrimCompliant, true, 'Trim <= 10% is API 610 compliant');

  // Excessive trim by 15% (320 mm to 272 mm)
  const excessiveTrim = PumpCentrifugalApi610.applyAffinityLaws(baseline, 272.0, 2950);
  assert.strictEqual(excessiveTrim.isTrimCompliant, false, 'Trim > 10% exceeds API 610 recommendation');
});

test('PumpHydraulicAnalysis: NPSHa & API 682 Mechanical Seal Selection', () => {
  // Test Case 1: Adequate NPSH margin
  const safeNpsh = PumpHydraulicAnalysis.evaluateNpsh({
    suctionVesselPressureBarg: 2.5,
    liquidVaporPressureBarg: 0.2,
    liquidDensityKgM3: 750.0,
    staticLiquidHeadM: 4.0,
    suctionFrictionLossM: 0.8,
    npshRequiredM: 3.2
  });

  assert.ok(safeNpsh.npshAvailableM > safeNpsh.npshRequiredM);
  assert.ok(safeNpsh.absoluteMarginM >= 1.0, 'Absolute margin should be >= 1.0 m');
  assert.ok(safeNpsh.marginRatio >= 1.35, 'Margin ratio should be >= 1.35');
  assert.strictEqual(safeNpsh.isCompliant, true);
  assert.strictEqual(safeNpsh.cavitationRisk, 'None / Safe Margins');

  // Test Case 2: Cavitating condition (NPSHa < NPSHr)
  const cavitating = PumpHydraulicAnalysis.evaluateNpsh({
    suctionVesselPressureBarg: 0.1,
    liquidVaporPressureBarg: 0.1, // Boiling fluid
    liquidDensityKgM3: 600.0,
    staticLiquidHeadM: 1.0,
    suctionFrictionLossM: 1.5, // High suction loss
    npshRequiredM: 3.0
  });
  assert.strictEqual(cavitating.isCompliant, false);
  assert.ok(cavitating.cavitationRisk.includes('Severe Choked Cavitation'));

  // Test Case 3: API 682 Seal Plan Selection
  const sourPlan = PumpHydraulicAnalysis.selectApi682SealPlan({ isSourH2S: true, isCryogenic: false, isHighTemperature: false, hasAbrasiveSolids: false });
  assert.ok(sourPlan.pipingPlan.includes('Plan 53B'), 'Sour H2S requires Plan 53B/53C pressurized barrier fluid');

  const cryoPlan = PumpHydraulicAnalysis.selectApi682SealPlan({ isSourH2S: false, isCryogenic: true, isHighTemperature: false, hasAbrasiveSolids: false });
  assert.ok(cryoPlan.pipingPlan.includes('Plan 72 / 74'), 'Cryogenic LNG requires Plan 72/74 dry gas seal');

  const hotPlan = PumpHydraulicAnalysis.selectApi682SealPlan({ isSourH2S: false, isCryogenic: false, isHighTemperature: true, hasAbrasiveSolids: false });
  assert.ok(hotPlan.pipingPlan.includes('Plan 21'), 'High temp requires Plan 21 cooler');
});

test('PumpPositiveDisplacement: API 674 Plunger Kinematics & Acceleration Head', () => {
  // Triplex Plunger Pump
  const triplex = PumpPositiveDisplacement.evaluateReciprocatingPlunger({
    plungerDiameterMm: 65.0,
    strokeLengthMm: 120.0,
    speedRpm: 320,
    numberOfPlungers: 3,
    suctionPressureBarg: 2.0,
    dischargePressureBarg: 140.0,
    liquidDensityKgM3: 998.0,
    suctionPipeLengthM: 15.0,
    suctionPipeDiameterMm: 80.0
  });

  assert.ok(triplex.pumpConfiguration.includes('Triplex'));
  assert.ok(triplex.actualCapacityM3H > 0);
  assert.ok(triplex.brakeHorsepowerKW > 0);
  assert.ok(triplex.accelerationHeadM > 0, 'Acceleration head ha must be calculated per API 674');
  assert.strictEqual(triplex.dischargePulsationPercent, 23.0, 'Triplex ripple is 23%');
  assert.ok(triplex.recommendedPulsationDampener.includes('Pulsation Dampener Mandatory'));

  // Quintuplex Plunger Pump
  const quintuplex = PumpPositiveDisplacement.evaluateReciprocatingPlunger({
    plungerDiameterMm: 65.0,
    strokeLengthMm: 120.0,
    speedRpm: 320,
    numberOfPlungers: 5,
    suctionPressureBarg: 2.0,
    dischargePressureBarg: 140.0,
    liquidDensityKgM3: 998.0,
    suctionPipeLengthM: 15.0,
    suctionPipeDiameterMm: 100.0
  });

  assert.ok(quintuplex.pumpConfiguration.includes('Quintuplex'));
  assert.strictEqual(quintuplex.dischargePulsationPercent, 7.0, 'Quintuplex ripple is 7%');
  assert.ok(quintuplex.accelerationHeadM < triplex.accelerationHeadM, 'Quintuplex has lower acceleration head coefficient C');
});
