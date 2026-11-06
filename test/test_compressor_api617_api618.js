'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CompressorCentrifugalApi617 } = require('../src/core/plant/rotating/compressor_centrifugal_api617');
const { CompressorReciprocatingApi618 } = require('../src/core/plant/rotating/compressor_reciprocating_api618');
const { CompressorAntisurgeDynamics } = require('../src/core/plant/rotating/compressor_antisurge_dynamics');

test('CompressorCentrifugalApi617: Schulz Polytropic Compression & Casing Selection', () => {
  // Test case 1: Natural gas pipeline booster (medium pressure, horizontally split candidate)
  const mediumPressResult = CompressorCentrifugalApi617.evaluateCompression({
    massFlowKgH: 150000, // 150 t/h
    inletPressureBarg: 25.0,
    dischargePressureBarg: 55.0,
    inletTempC: 25.0,
    molecularWeight: 17.5,
    polytropicEfficiency: 0.83,
    specificHeatRatioGamma: 1.30,
    inletCompressibilityZ1: 0.94,
    dischargeCompressibilityZ2: 0.92,
    casingType: 'horizontally_split'
  });

  assert.ok(mediumPressResult.polytropicHeadKJkg > 80.0, 'Polytropic head should be > 80 kJ/kg');
  assert.ok(mediumPressResult.dischargeTempC > mediumPressResult.suctionTempC, 'Discharge temp must be higher than suction');
  assert.ok(mediumPressResult.shaftPowerMW > 4.0 && mediumPressResult.shaftPowerMW < 10.0, 'Shaft power in realistic range (4-10 MW)');
  assert.strictEqual(mediumPressResult.casingType, 'horizontally_split', 'Under 60 bar, horizontally split is retained');

  // Test case 2: World-scale LNG refrigerant compressor (P2 = 75 barg > 60 barg -> requires barrel casing per API 617)
  const highPressResult = CompressorCentrifugalApi617.evaluateCompression({
    massFlowKgH: 450000, // 450 t/h
    inletPressureBarg: 15.0,
    dischargePressureBarg: 75.0,
    inletTempC: -20.0,
    molecularWeight: 28.5, // Mixed refrigerant
    polytropicEfficiency: 0.84,
    casingType: 'horizontally_split' // User attempted horizontally split
  });

  assert.strictEqual(highPressResult.casingType, 'barrel', 'API 617 should mandate barrel casing for discharge > 60 bar');
  assert.ok(highPressResult.casingComplianceNote.includes('API 617 mandates Radially Split Barrel'));
  assert.ok(highPressResult.shaftPowerMW > 15.0, 'High mass flow refrigeration compressor power should be > 15 MW');
  assert.ok(highPressResult.recommendedDriverRatingMW > highPressResult.shaftPowerMW, 'Driver rating includes API 617 15% margin');
});

test('CompressorReciprocatingApi618: Cylinder Kinematics, Rod Loading & Pin Reversal', () => {
  const recipResult = CompressorReciprocatingApi618.evaluateCylinderStage({
    boreDiameterMm: 350.0,
    strokeMm: 250.0,
    rodDiameterMm: 80.0,
    speedRpm: 450,
    suctionPressureBarg: 10.0,
    dischargePressureBarg: 35.0,
    suctionTempC: 30.0,
    molecularWeight: 16.8,
    clearanceVolumeRatio: 0.16,
    connectingRodLengthMm: 650.0,
    reciprocatingMassKg: 65.0,
    maxAllowableRodLoadKN: 300.0
  });

  assert.ok(recipResult.volumetricEfficiencyPct > 60.0 && recipResult.volumetricEfficiencyPct < 95.0, 'Volumetric efficiency within realistic range');
  assert.ok(recipResult.actualCapacityM3H > 0, 'Actual capacity must be positive');
  assert.ok(recipResult.maxTensionRodLoadKN > 0, 'Tension rod load must be computed');
  assert.ok(recipResult.maxCompressionRodLoadKN > 0, 'Compression rod load must be computed');
  assert.strictEqual(recipResult.isRodLoadCompliant, true, 'Rod load must be within allowable 300 kN rating');
  assert.ok(recipResult.pinReversalAngleDegrees >= 15, 'Pin reversal must meet API 618 minimum >= 15 degrees');
  assert.strictEqual(recipResult.isPinReversalCompliant, true, 'Pin reversal compliance must be true');
  assert.ok(recipResult.recommendedPulsationBottleLiters > 50, 'Pulsation bottle volume must be sized per API 618');

  // Verify overload detection on undersized frame (200 kN rating)
  const overloadResult = CompressorReciprocatingApi618.evaluateCylinderStage({
    boreDiameterMm: 350.0,
    strokeMm: 250.0,
    rodDiameterMm: 80.0,
    speedRpm: 450,
    suctionPressureBarg: 10.0,
    dischargePressureBarg: 35.0,
    suctionTempC: 30.0,
    molecularWeight: 16.8,
    maxAllowableRodLoadKN: 200.0
  });
  assert.strictEqual(overloadResult.isRodLoadCompliant, false, 'Undersized frame should be flagged as overloaded');
});

test('CompressorAntisurgeDynamics: Surge Line Tracking & Control Margin', () => {
  const normalStatus = CompressorAntisurgeDynamics.evaluateSurgeStatus({
    actualVolumetricFlowM3H: 22000.0,
    suctionPressureBarg: 20.0,
    dischargePressureBarg: 60.0,
    currentSpeedRpm: 8000,
    ratedSpeedRpm: 8000,
    baseSurgeFlowAtRatedSpeedM3H: 15000.0,
    safetyMarginPercent: 12.0
  });

  assert.strictEqual(normalStatus.isSurgeDetected, false);
  assert.strictEqual(normalStatus.antiSurgeValveCommandPercent, 0.0, 'Valve should remain closed during safe operation');
  assert.ok(normalStatus.surgeMarginPercent > 40.0, 'Margin should be ~46%');

  // Throttled flow inside control margin: flow = 16000 m3/h (between 15000 surge and 16800 control line)
  const throttledStatus = CompressorAntisurgeDynamics.evaluateSurgeStatus({
    actualVolumetricFlowM3H: 16000.0,
    suctionPressureBarg: 20.0,
    dischargePressureBarg: 60.0,
    currentSpeedRpm: 8000,
    ratedSpeedRpm: 8000,
    baseSurgeFlowAtRatedSpeedM3H: 15000.0,
    safetyMarginPercent: 12.0
  });

  assert.strictEqual(throttledStatus.isSurgeDetected, false);
  assert.ok(throttledStatus.antiSurgeValveCommandPercent > 0.0 && throttledStatus.antiSurgeValveCommandPercent < 100.0, 'Valve should modulate open');
  assert.ok(throttledStatus.systemState.includes('Modulating ASV Open'));

  // Critical surge breach: flow = 14000 m3/h < 15000 m3/h
  const surgeStatus = CompressorAntisurgeDynamics.evaluateSurgeStatus({
    actualVolumetricFlowM3H: 14000.0,
    suctionPressureBarg: 20.0,
    dischargePressureBarg: 60.0,
    currentSpeedRpm: 8000,
    ratedSpeedRpm: 8000,
    baseSurgeFlowAtRatedSpeedM3H: 15000.0,
    safetyMarginPercent: 12.0
  });

  assert.strictEqual(surgeStatus.isSurgeDetected, true);
  assert.strictEqual(surgeStatus.antiSurgeValveCommandPercent, 100.0, 'Valve must snap 100% open on surge');
  assert.ok(surgeStatus.systemState.includes('CRITICAL: Surge Inception'));
});

test('CompressorAntisurgeDynamics: Anti-Surge Recycle Valve Sizing', () => {
  const asvResult = CompressorAntisurgeDynamics.sizeAntiSurgeValve({
    surgeMassFlowKgH: 120000.0,
    dischargePressureBarg: 65.0,
    suctionPressureBarg: 22.0,
    dischargeTempC: 95.0,
    molecularWeight: 18.0,
    oversizingFactor: 1.35
  });

  assert.strictEqual(asvResult.designRecycleMassFlowKgH, 162000);
  assert.ok(asvResult.requiredCv > 100.0, 'Required Cv must be calculated');
  assert.strictEqual(asvResult.maxAllowableStrokeTimeSec, 1.5, 'API 617 stroke speed limit is 1.5 seconds');
  assert.strictEqual(asvResult.noiseAttenuatingTrimRequired, true, 'Pressure drop > 20 bar requires noise trim');
});
