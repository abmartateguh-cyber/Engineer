'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CompressorScrewApi619 } = require('../src/core/plant/rotating/compressor_screw_api619');
const { CompressorIntegrallyGearedApi672 } = require('../src/core/plant/rotating/compressor_integrally_geared_api672');
const { Turboexpander } = require('../src/core/plant/rotating/turboexpander');
const { PumpSeallessApi685, CONTAINMENT_SHELL_MATERIALS } = require('../src/core/plant/rotating/pump_sealless_api685');
const { PumpApi675Api676 } = require('../src/core/plant/rotating/pump_api675_api676');
const { PumpSlurryProgressiveCavity } = require('../src/core/plant/rotating/pump_slurry_progressive_cavity');
const { DriverGasTurbine, GAS_TURBINE_CATALOG } = require('../src/core/plant/rotating/driver_gas_turbine');
const { DriverSteamTurbine } = require('../src/core/plant/rotating/driver_steam_turbine');
const { DriverElectricMotor } = require('../src/core/plant/rotating/driver_electric_motor');
const { RotordynamicsVibration } = require('../src/core/plant/rotating/rotordynamics_vibration');
const { LubeSealOilApi614 } = require('../src/core/plant/rotating/lube_seal_oil_api614');

// ============================================================================
// 1. API 619 ROTARY SCREW COMPRESSOR TESTS
// ============================================================================
test('CompressorScrewApi619: evaluateScrewCompressor thermodynamic regimes and oil-flooded vs dry', () => {
  // Case A: Oil-flooded screw with matched compression (Vi = 3.6, rc approx matched)
  const floodedMatched = CompressorScrewApi619.evaluateScrewCompressor({
    massFlowKgH: 12000.0,
    suctionPressureBarg: 2.0,
    dischargePressureBarg: 14.92,
    suctionTempC: 30.0,
    molecularWeight: 28.0,
    specificHeatRatioGamma: 1.30,
    builtInVolumeRatioVi: 3.6,
    isOilFlooded: true,
    oilInletTempC: 45.0,
    compressorSpeedRpm: 2950
  });

  assert.strictEqual(floodedMatched.compressorType, 'API 619 Oil-Flooded Rotary Screw');
  assert.strictEqual(floodedMatched.compressionRegime, 'matched');
  assert.ok(floodedMatched.systemPressureRatio > 4.5 && floodedMatched.systemPressureRatio < 5.5);
  assert.ok(floodedMatched.shaftPowerKW > 200.0 && floodedMatched.shaftPowerKW < 900.0);
  assert.strictEqual(floodedMatched.highDischargeTempRisk, false);
  assert.strictEqual(floodedMatched.isThermallyAcceptable, true);
  assert.ok(floodedMatched.dischargeTempC < 110.0, 'Flooded oil cooling limits discharge temp');
  assert.ok(floodedMatched.oilCirculationKgH > 0);
  assert.ok(floodedMatched.oilHeatDutyKW > 0);

  // Case B: Dry screw compressor with over-compression (Vi = 4.5, low system rc = 2.5)
  const dryOverCompressed = CompressorScrewApi619.evaluateScrewCompressor({
    massFlowKgH: 8000.0,
    suctionPressureBarg: 1.0,
    dischargePressureBarg: 4.0,
    suctionTempC: 25.0,
    molecularWeight: 18.0,
    builtInVolumeRatioVi: 4.5,
    isOilFlooded: false,
    compressorSpeedRpm: 4500
  });

  assert.strictEqual(dryOverCompressed.compressorType, 'API 619 Dry Rotary Screw');
  assert.strictEqual(dryOverCompressed.compressionRegime, 'over_compression');
  assert.ok(dryOverCompressed.indicatorLossPercent > 0.0);
  assert.ok(dryOverCompressed.dischargeTempC > 100.0, 'Dry screw has high discharge temp');

  // Case C: Under-compression regime (system rc = 9.0, built-in Vi = 2.5)
  const underCompressed = CompressorScrewApi619.evaluateScrewCompressor({
    massFlowKgH: 10000.0,
    suctionPressureBarg: 1.0,
    dischargePressureBarg: 17.0,
    suctionTempC: 25.0,
    molecularWeight: 20.0,
    builtInVolumeRatioVi: 2.5,
    isOilFlooded: true
  });
  assert.strictEqual(underCompressed.compressionRegime, 'under_compression');
  assert.ok(underCompressed.indicatorLossPercent > 0.0);

  // Boundary error tests
  assert.throws(() => {
    CompressorScrewApi619.evaluateScrewCompressor({
      massFlowKgH: -100,
      suctionPressureBarg: 1.0,
      dischargePressureBarg: 5.0,
      suctionTempC: 20.0,
      molecularWeight: 28.0
    });
  }, /Mass flow must be positive/);

  assert.throws(() => {
    CompressorScrewApi619.evaluateScrewCompressor({
      massFlowKgH: 5000,
      suctionPressureBarg: 5.0,
      dischargePressureBarg: 2.0,
      suctionTempC: 20.0,
      molecularWeight: 28.0
    });
  }, /Discharge pressure must exceed suction pressure/);
});

test('CompressorScrewApi619: evaluateSlideValveTurndown and evaluateEconomizerPort', () => {
  // Slide valve turndown at 60% position
  const turndown60 = CompressorScrewApi619.evaluateSlideValveTurndown({
    fullLoadShaftPowerKW: 500.0,
    fullLoadCapacityM3H: 1500.0,
    slideValvePositionPercent: 60.0
  });

  assert.strictEqual(turndown60.slideValvePositionPercent, 60.0);
  assert.strictEqual(turndown60.actualCapacityM3H, 900.0);
  assert.ok(turndown60.shaftPowerPercent > 60.0, 'Power percentage exceeds capacity percentage due to specific power penalty');
  assert.ok(turndown60.specificPowerPenaltyPercent > 0.0);
  assert.strictEqual(turndown60.economizerPortAvailable, false);

  // Slide valve at 90% (economizer active)
  const turndown90 = CompressorScrewApi619.evaluateSlideValveTurndown({
    fullLoadShaftPowerKW: 500.0,
    fullLoadCapacityM3H: 1500.0,
    slideValvePositionPercent: 90.0,
    controlCurveType: 'high_efficiency_variable_vi'
  });
  assert.strictEqual(turndown90.economizerPortAvailable, true);

  // Economizer intermediate port evaluation
  const ecoResult = CompressorScrewApi619.evaluateEconomizerPort({
    suctionMassFlowKgH: 15000.0,
    economizerMassFlowKgH: 3500.0,
    suctionPressureBarg: 1.5,
    dischargePressureBarg: 16.0,
    suctionTempC: -15.0,
    economizerGasTempC: 5.0,
    molecularWeight: 44.0 // Propane / LNG refrigerant
  });

  assert.strictEqual(ecoResult.totalDischargeMassFlowKgH, 18500.0);
  assert.ok(ecoResult.economizerPortPressureBarg > 1.5 && ecoResult.economizerPortPressureBarg < 16.0);
  assert.ok(ecoResult.stage1PowerKW > 0);
  assert.ok(ecoResult.stage2PowerKW > 0);
  assert.ok(ecoResult.powerSavingsPercent > 0, 'Economizer cycle provides power savings over full compression');
  assert.ok(ecoResult.capacityBoostPercent > 20.0);
});

// ============================================================================
// 2. API 672 INTEGRALLY GEARED COMPRESSOR TESTS
// ============================================================================
test('CompressorIntegrallyGearedApi672: evaluateIntegrallyGearedCompressor multi-stage and intercoolers', () => {
  const trainResult = CompressorIntegrallyGearedApi672.evaluateIntegrallyGearedCompressor({
    massFlowKgH: 25000.0,
    suctionPressureBarg: 0.0, // Atmospheric air suction
    targetDischargePressureBarg: 9.0, // 10 bar abs discharge
    suctionTempC: 25.0,
    molecularWeight: 28.96, // Air
    driverSpeedRpm: 1500,
    stageCount: 3,
    intercoolerApproachTempC: 35.0,
    intercoolerDeltaPBar: 0.15
  });

  assert.strictEqual(trainResult.standard, 'API 672 / API 617 Part 3');
  assert.strictEqual(trainResult.stageCount, 3);
  assert.strictEqual(trainResult.stages.length, 3);
  assert.strictEqual(trainResult.pinionShaftCount, 2);
  assert.ok(trainResult.totalShaftPowerKW > 1200.0 && trainResult.totalShaftPowerKW < 3500.0);
  assert.ok(trainResult.totalIntercoolerDutyKW > 500.0);
  assert.ok(trainResult.coolingWaterDemandM3H > 0);

  // Check stage progression
  assert.strictEqual(trainResult.stages[0].stageNumber, 1);
  assert.ok(trainResult.stages[0].pinionSpeedRpm >= 15000);
  assert.ok(trainResult.stages[0].impellerTipSpeedMS > 150.0);
  assert.ok(trainResult.stages[2].dischargePressureBarg >= 8.8, 'Final discharge reaches target pressure');

  // Input validation
  assert.throws(() => {
    CompressorIntegrallyGearedApi672.evaluateIntegrallyGearedCompressor({
      massFlowKgH: 1000,
      suctionPressureBarg: 1.0,
      targetDischargePressureBarg: 1.0,
      suctionTempC: 20,
      molecularWeight: 28
    });
  }, /Target discharge pressure must exceed suction pressure/);
});

test('CompressorIntegrallyGearedApi672: evaluateIgvTurndown aerodynamic pre-whirl', () => {
  // Test turndown at +20° IGV
  const igvTurndown = CompressorIntegrallyGearedApi672.evaluateIgvTurndown({
    ratedMassFlowKgH: 30000.0,
    ratedShaftPowerKW: 2200.0,
    igvAngleDegrees: 20.0
  });

  assert.strictEqual(igvTurndown.igvAngleDegrees, 20.0);
  assert.strictEqual(igvTurndown.operationMode, 'Turndown (Co-swirl)');
  assert.ok(igvTurndown.actualMassFlowKgH < 30000.0);
  assert.ok(igvTurndown.igvShaftPowerKW < igvTurndown.suctionThrottlePowerKW, 'IGV should be more efficient than suction throttle');
  assert.ok(igvTurndown.powerSavedKW > 50.0);
  assert.ok(igvTurndown.savingsPercentVsThrottle > 5.0);

  // Test overboost at -15° IGV
  const igvOverboost = CompressorIntegrallyGearedApi672.evaluateIgvTurndown({
    ratedMassFlowKgH: 30000.0,
    ratedShaftPowerKW: 2200.0,
    igvAngleDegrees: -15.0
  });
  assert.strictEqual(igvOverboost.operationMode, 'Overboost (Counter-swirl)');
  assert.ok(igvOverboost.actualMassFlowKgH > 30000.0);
});

// ============================================================================
// 3. API 617 CRYOGENIC TURBOEXPANDER-RECOMPRESSOR TESTS
// ============================================================================
test('Turboexpander: evaluateTurboexpander cryogenic expansion and compander power balance', () => {
  const expanderResult = Turboexpander.evaluateTurboexpander({
    massFlowKgH: 80000.0,
    inletPressureBarg: 60.0,
    outletPressureBarg: 22.0,
    inletTempC: -30.0,
    molecularWeight: 17.5,
    specificHeatRatioGamma: 1.28,
    expanderEfficiency: 0.86,
    dewPointTempC: -62.0,
    latentHeatKJkg: 390.0
  });

  assert.strictEqual(expanderResult.standard, 'API 617 Part 4 Cryogenic Turboexpander-Recompressor');
  assert.ok(expanderResult.expansionPressureRatio > 2.5);
  assert.ok(expanderResult.actualEnthalpyDropKJkg > 60.0);
  assert.ok(expanderResult.shaftPowerRecoveredKW > 1200.0);
  assert.ok(expanderResult.shaftPowerRecoveredMW > 1.2);
  assert.ok(expanderResult.outletTempC < -50.0);

  // Recompressor brake boost
  assert.ok(expanderResult.recompressor.powerAvailableKW > 1000.0);
  assert.ok(expanderResult.recompressor.dischargePressureBarg > expanderResult.recompressor.inletPressureBarg);
  assert.ok(expanderResult.recompressor.pressureBoostRatio > 1.05);

  // Boundary error test
  assert.throws(() => {
    Turboexpander.evaluateTurboexpander({
      massFlowKgH: 50000,
      inletPressureBarg: 20.0,
      outletPressureBarg: 25.0,
      inletTempC: 0,
      molecularWeight: 18
    });
  }, /Expander inlet pressure must exceed outlet pressure/);
});

test('Turboexpander: compareWithJtValve isentropic vs isenthalpic liquid yield', () => {
  const comparison = Turboexpander.compareWithJtValve({
    massFlowKgH: 100000.0,
    inletPressureBarg: 65.0,
    outletPressureBarg: 20.0,
    inletTempC: -35.0,
    molecularWeight: 18.0,
    expanderEfficiency: 0.86,
    dewPointTempC: -60.0
  });

  assert.ok(comparison.turboexpander.temperatureDropC > comparison.jouleThomsonValve.temperatureDropC,
    'Turboexpander delivers deeper cryogenic cooling than JT valve');
  assert.ok(comparison.turboexpanderAdvantage.additionalCoolingC > 0);
  assert.ok(comparison.turboexpander.shaftPowerRecoveredKW > 1500.0);
  assert.strictEqual(comparison.jouleThomsonValve.shaftPowerRecoveredKW, 0.0);
  assert.ok(comparison.turboexpander.liquidProductionKgH > comparison.jouleThomsonValve.liquidProductionKgH,
    'Turboexpander condenses heavy hydrocarbons into liquid while JT valve produces no liquid');
  assert.ok(comparison.turboexpanderAdvantage.additionalLiquidRecoveryKgH > 0);
});

// ============================================================================
// 4. API 685 SEALLESS PUMPS TESTS
// ============================================================================
test('PumpSeallessApi685: evaluateContainmentShellLoss materials & eddy current', () => {
  // Metallic shell (Hastelloy C-276)
  const hastelloyLoss = PumpSeallessApi685.evaluateContainmentShellLoss({
    shellMaterial: 'HASTELLOY_C276',
    speedRpm: 2950,
    shellDiameterMm: 140.0,
    shellWallThicknessMm: 1.5
  });
  assert.strictEqual(hastelloyLoss.isNonConductive, false);
  assert.ok(hastelloyLoss.eddyCurrentLossKW > 0.3);

  // Non-metallic ceramic shell (zero loss)
  const ceramicLoss = PumpSeallessApi685.evaluateContainmentShellLoss({
    shellMaterial: 'CERAMIC_ZIRCONIA',
    speedRpm: 2950
  });
  assert.strictEqual(ceramicLoss.isNonConductive, true);
  assert.strictEqual(ceramicLoss.eddyCurrentLossKW, 0.0);
});

test('PumpSeallessApi685: evaluateSeallessPump hydraulics, flush plan, and boiling margin', () => {
  // Normal cold LPG / butane pump with Plan 11-SE and adequate boiling margin
  const safePump = PumpSeallessApi685.evaluateSeallessPump({
    flowRateM3H: 60.0,
    differentialHeadM: 110.0,
    suctionPressureBarg: 6.0,
    dischargePressureBarg: 14.0,
    suctionTempC: 15.0,
    liquidDensityKgM3: 580.0, // Liquefied hydrocarbon
    vaporPressureAtSuctionTempBara: 2.5,
    vaporPressureSlopeBarPerC: 0.08,
    speedRpm: 2950,
    shellMaterial: 'HASTELLOY_C276',
    circulationPlan: 'PLAN_11SE'
  });

  assert.strictEqual(safePump.standard, 'API 685 (Sealless Centrifugal Pumps)');
  assert.ok(safePump.hydraulicPowerKW > 5.0);
  assert.ok(safePump.totalPumpInputPowerKW > safePump.hydraulicPowerKW);
  assert.ok(safePump.circulationFlush.temperatureRiseC < 15.0);
  assert.strictEqual(safePump.circulationFlush.meetsBoilingMargin, true);
  assert.strictEqual(safePump.circulationFlush.dryRunVaporLockRisk, false);

  // Severe near-boiling service with Plan 13-SE leading to vapor lock risk
  const riskyPump = PumpSeallessApi685.evaluateSeallessPump({
    flowRateM3H: 50.0,
    differentialHeadM: 80.0,
    suctionPressureBarg: 1.5,
    dischargePressureBarg: 7.0,
    suctionTempC: 38.0,
    liquidDensityKgM3: 600.0,
    vaporPressureAtSuctionTempBara: 2.3, // Very close to suction pressure (2.51 bara)
    vaporPressureSlopeBarPerC: 0.12,
    speedRpm: 2950,
    circulationPlan: 'PLAN_13SE',
    circulationFlowRateM3H: 0.5 // severely throttled flush
  });

  assert.strictEqual(riskyPump.circulationFlush.meetsBoilingMargin, false);
  assert.strictEqual(riskyPump.circulationFlush.dryRunVaporLockRisk, true);
});

// ============================================================================
// 5. API 675 & API 676 POSITIVE DISPLACEMENT PUMPS TESTS
// ============================================================================
test('PumpApi675Api676: evaluateApi675MeteringPump chemical injection and NPIP', () => {
  const meteringResult = PumpApi675Api676.evaluateApi675MeteringPump({
    maxRatedCapacityLPH: 500.0,
    strokeLengthPercent: 75.0,
    strokeSpeedPercent: 80.0,
    suctionPressureBarg: 1.0,
    dischargePressureBarg: 65.0,
    liquidDensityKgM3: 1150.0, // Corrosion inhibitor chemical
    vaporPressureBara: 0.05,
    suctionPipeLengthM: 8.0,
    suctionPipeInternalDiameterMm: 25.0,
    npipRequiredBar: 0.35
  });

  assert.strictEqual(meteringResult.standard, 'API 675 Controlled-Volume Metering Pump');
  assert.strictEqual(meteringResult.strokeLengthSettingPercent, 75.0);
  assert.ok(meteringResult.actualCapacityLPH > 250.0 && meteringResult.actualCapacityLPH < 350.0);
  assert.strictEqual(meteringResult.qualityMetrics.satisfiesApi675Accuracy, true);
  assert.ok(meteringResult.npipAudit.accelerationPressureLossBar > 0);
  assert.strictEqual(meteringResult.npipAudit.meetsNpipRequirements, true);
  assert.strictEqual(meteringResult.npipAudit.cavitationRisk, false);
});

test('PumpApi675Api676: evaluateApi676RotaryPump viscous slip model vs viscosity', () => {
  // Low viscosity (thin fluid: 1.5 cP) -> high slip, moderate volumetric efficiency
  const lowVisc = PumpApi675Api676.evaluateApi676RotaryPump({
    displacementLitersPerRev: 1.2,
    operatingSpeedRpm: 1450,
    differentialPressureBar: 16.0,
    dynamicViscosityCP: 1.5,
    pumpType: 'TWIN_SCREW'
  });

  // High viscosity (heavy lube / fuel oil: 600 cP) -> near zero slip, high volumetric efficiency
  const highVisc = PumpApi675Api676.evaluateApi676RotaryPump({
    displacementLitersPerRev: 1.2,
    operatingSpeedRpm: 1450,
    differentialPressureBar: 16.0,
    dynamicViscosityCP: 600.0,
    pumpType: 'TWIN_SCREW'
  });

  assert.ok(highVisc.slipFlowM3H < lowVisc.slipFlowM3H, 'Viscous fluid significantly reduces clearance slip');
  assert.ok(highVisc.volumetricEfficiencyPct > lowVisc.volumetricEfficiencyPct, 'Volumetric efficiency increases with viscosity');
  assert.strictEqual(highVisc.isViscosityBeneficial, true);
  assert.ok(highVisc.viscousShearLossKW > lowVisc.viscousShearLossKW, 'Viscous shear dissipation increases with viscosity');
});

// ============================================================================
// 6. SLURRY PUMP & PROGRESSIVE CAVITY PUMP TESTS
// ============================================================================
test('PumpSlurryProgressiveCavity: evaluateSlurryPumpDerating and critical velocity', () => {
  const slurryResult = PumpSlurryProgressiveCavity.evaluateSlurryPumpDerating({
    clearWaterFlowRateM3H: 350.0,
    clearWaterHeadM: 45.0,
    clearWaterEfficiency: 0.78,
    solidsSpecificGravity: 2.65, // Silica sand
    solidsVolumeFractionCv: 0.20,
    medianParticleDiameterMicrons: 250.0
  });

  assert.strictEqual(slurryResult.standard, 'Hydraulic Institute HI 12.1-12.6 Slurry Centrifugal');
  assert.ok(slurryResult.solidsProperties.slurryDensityKgM3 > 1200.0);
  assert.ok(slurryResult.deratingFactors.headRatioHR < 1.0 && slurryResult.deratingFactors.headRatioHR > 0.70);
  assert.ok(slurryResult.deratingFactors.efficiencyRatioER < 1.0);
  assert.ok(slurryResult.hydraulicPerformance.slurryShaftPowerKW > slurryResult.hydraulicPerformance.clearWaterPowerKW,
    'Slurry shaft power is higher due to mixture density and derated efficiency');

  // Critical deposition velocity check
  const deposition = PumpSlurryProgressiveCavity.evaluateCriticalDepositionVelocity({
    pipeInternalDiameterMm: 200.0,
    solidsSpecificGravity: 2.65,
    volumeConcentrationCv: 0.20,
    medianParticleDiameterMicrons: 250.0
  });
  assert.ok(deposition.criticalDepositionVelocityMS > 1.5);
  assert.ok(deposition.recommendedMinOperatingVelocityMS > deposition.criticalDepositionVelocityMS);
});

test('PumpSlurryProgressiveCavity: evaluateProgressiveCavityPump geometry and multi-stage sizing', () => {
  const pcpResult = PumpSlurryProgressiveCavity.evaluateProgressiveCavityPump({
    rotorDiameterMm: 50.0,
    eccentricityMm: 8.0,
    statorPitchMm: 160.0,
    speedRpm: 320,
    differentialPressureBar: 18.0, // Requires 3 stages at 6 bar/stage
    dynamicViscosityCP: 2500.0,
    elastomerType: 'HNBR'
  });

  assert.strictEqual(pcpResult.mechanism, 'Progressive Cavity Pump (Moineau Principle)');
  assert.strictEqual(pcpResult.stageStaging.requiredStatorStages, 3);
  assert.strictEqual(pcpResult.stageStaging.pressurePerStageBar, 6.0);
  assert.ok(pcpResult.performance.actualDeliveredFlowM3H > 0);
  assert.strictEqual(pcpResult.elastomerStator.material, 'HNBR');
  assert.strictEqual(pcpResult.elastomerStator.oilResistance, 'Excellent');
});

// ============================================================================
// 7. GAS TURBINE DRIVER TESTS
// ============================================================================
test('DriverGasTurbine: evaluateGasTurbineDriver site derating and helper motor sizing', () => {
  const models = DriverGasTurbine.getGasTurbineModels();
  assert.ok(models.length >= 6);

  // ISO conditions (15°C, sea level, zero duct loss) on Frame 7EA
  const isoRun = DriverGasTurbine.evaluateGasTurbineDriver({
    modelKey: 'FRAME_7EA',
    ambientTempC: 15.0,
    siteAltitudeM: 0.0,
    inletLossMbar: 0.0,
    exhaustLossMbar: 0.0
  });
  assert.strictEqual(isoRun.powerAndEfficiency.siteAvailablePowerMW, 86.0);
  assert.strictEqual(isoRun.powerAndEfficiency.isoRatingMW, 86.0);

  // Hot summer day in Middle East LNG plant (45°C, 10 mbar inlet filter, 25 mbar HRSG backpressure)
  const summerRun = DriverGasTurbine.evaluateGasTurbineDriver({
    modelKey: 'FRAME_7EA',
    ambientTempC: 45.0,
    siteAltitudeM: 100.0,
    inletLossMbar: 10.0,
    exhaustLossMbar: 25.0
  });
  assert.ok(summerRun.powerAndEfficiency.siteAvailablePowerMW < 70.0, 'Hot day derates GT significantly');
  assert.ok(summerRun.powerAndEfficiency.siteHeatRateKJkWh > isoRun.powerAndEfficiency.siteHeatRateKJkWh);
  assert.ok(summerRun.exhaustEnergy.hrsgAvailableHeatMWth > 0);
  assert.ok(summerRun.exhaustEnergy.estimatedSteamProductionTH > 50.0);

  // Helper motor sizing for 82 MW compressor demand during 45°C summer
  const helper = DriverGasTurbine.sizeHelperDriver({
    modelKey: 'FRAME_7EA',
    compressorShaftPowerDemandMW: 82.0,
    summerDesignAmbientTempC: 45.0
  });
  assert.strictEqual(helper.helperDriverRequired, true);
  assert.ok(helper.recommendedHelperRatingMW > 15.0);
  assert.ok(helper.recommendation.includes('helper electric motor'));
});

// ============================================================================
// 8. STEAM TURBINE DRIVER TESTS
// ============================================================================
test('DriverSteamTurbine: evaluateSteamTurbine backpressure and condensing cycles', () => {
  // Backpressure mechanical driver (e.g. driving BOG compressor)
  const backpressureTurbine = DriverSteamTurbine.evaluateSteamTurbine({
    inletPressureBarg: 42.0,
    inletTempC: 410.0,
    exhaustPressureBarg: 4.5,
    shaftPowerKW: 4500.0,
    internalEfficiency: 0.77,
    turbineType: 'BACKPRESSURE'
  });

  assert.strictEqual(backpressureTurbine.standard, 'API 612 Special-Purpose Steam Turbine');
  assert.strictEqual(backpressureTurbine.turbineType, 'BACKPRESSURE');
  assert.ok(backpressureTurbine.thermodynamics.isentropicEnthalpyDropKJkg > 300.0);
  assert.ok(backpressureTurbine.thermodynamics.actualSteamRateKgKWh > 0);
  assert.ok(backpressureTurbine.consumption.throttleSteamFlowKgH > 10000.0);
  assert.strictEqual(backpressureTurbine.exhaustQuality.meetsApi612MoistureLimit, true);

  // Condensing turbine (0.08 bara exhaust)
  const condensingTurbine = DriverSteamTurbine.evaluateSteamTurbine({
    inletPressureBarg: 65.0,
    inletTempC: 480.0,
    exhaustPressureBara: 0.08,
    shaftPowerKW: 18000.0, // 18 MW
    internalEfficiency: 0.81,
    turbineType: 'CONDENSING'
  });
  assert.strictEqual(condensingTurbine.turbineType, 'CONDENSING');
  assert.ok(condensingTurbine.condenser !== null);
  assert.ok(condensingTurbine.condenser.condenserHeatDutyMWth > 10.0);
  assert.ok(condensingTurbine.condenser.coolingWaterFlowM3H > 1000.0);

  // Willans line model
  const willans = DriverSteamTurbine.evaluateWillansLine({
    ratedPowerKW: 5000.0,
    ratedSteamRateKgKWh: 6.2
  });
  assert.ok(willans.noLoadSteamFlowF0_KgH > 0);
  assert.strictEqual(willans.performanceTable.length, 6);
  assert.strictEqual(willans.performanceTable[4].loadPercent, 100);
});

// ============================================================================
// 9. ELECTRIC MOTOR DRIVER TESTS
// ============================================================================
test('DriverElectricMotor: evaluateElectricMotor IEC sizing, starting inrush and VFD derating', () => {
  // 6.6 kV Medium Voltage Compressor Motor Sizing (Demand: 3100 kW)
  const motor = DriverElectricMotor.evaluateElectricMotor({
    shaftPowerDemandKW: 3100.0,
    supplyVoltageV: 6600,
    gridFrequencyHz: 50,
    poleCount: 2,
    efficiencyClass: 'IE4',
    apiSizingMarginPercent: 10.0,
    busVoltageDipPercent: 15.0
  });

  assert.strictEqual(motor.standard, 'IEC 60034 / NEMA MG-1 Electric Motor Driver');
  assert.ok(motor.motorRatingKW >= 3410.0);
  assert.ok(motor.electricalParameters.efficiencyPct > 96.0);
  assert.ok(motor.electricalParameters.fullLoadAmperes > 200.0 && motor.electricalParameters.fullLoadAmperes < 500.0);
  assert.ok(motor.electricalParameters.lockedRotorAmperes > motor.electricalParameters.fullLoadAmperes * 5.0);
  assert.strictEqual(motor.torqueDynamics.startingAcceleratesSuccessfully, true);

  // VFD low-speed shaft fan cooling derating (TEFC vs Forced Blower)
  const vfdTefcLowSpeed = DriverElectricMotor.evaluateVfdDerating({
    motorRatingKW: 1000.0,
    speedRatio: 0.35,
    coolingType: 'IC411_TEFC'
  });
  assert.ok(vfdTefcLowSpeed.coolingDerateFactor < 0.80, 'Low speed TEFC fan causes significant thermal derating');
  assert.ok(vfdTefcLowSpeed.coolingRecommendation.includes('IC 416'));

  const vfdForcedBlower = DriverElectricMotor.evaluateVfdDerating({
    motorRatingKW: 1000.0,
    speedRatio: 0.35,
    coolingType: 'IC416_FORCED'
  });
  assert.strictEqual(vfdForcedBlower.coolingDerateFactor, 1.0, 'Forced blower provides 100% cooling capability at all speeds');
});

// ============================================================================
// 10. ROTORDYNAMICS & VIBRATION TESTS
// ============================================================================
test('RotordynamicsVibration: evaluateJeffcottRotor, separation margins, and ISO 20816', () => {
  const rotor = RotordynamicsVibration.evaluateJeffcottRotor({
    rotorMassKg: 650.0,
    shaftSpanMm: 1800.0,
    shaftDiameterMm: 160.0,
    shaftModulusGPa: 206.0,
    bearingStiffnessNPerM: 2.0e8,
    bearingDampingNsPerM: 2.2e5,
    operatingSpeedRpm: 8500
  });

  assert.strictEqual(rotor.standard, 'API 684 Rotordynamics Analysis');
  assert.ok(rotor.criticalSpeeds.firstLateralCriticalSpeedRpm > 2000);
  assert.ok(rotor.criticalSpeeds.secondLateralCriticalSpeedRpm > rotor.criticalSpeeds.firstLateralCriticalSpeedRpm);
  assert.ok(rotor.damping.amplificationFactorAF > 0);

  // API 617 Separation Margin evaluation: Sub-critical vs Super-critical
  const subCriticalEval = RotordynamicsVibration.evaluateSeparationMargin({
    criticalSpeedRpm: 5000,
    operatingSpeedRpm: 3800, // 24% below critical
    amplificationFactor: 3.5
  });
  assert.strictEqual(subCriticalEval.meetsSeparationMargin, true);
  assert.strictEqual(subCriticalEval.clearanceStatus, 'Acceptable separation margin maintained');

  // Machine operating right inside critical exclusion band
  const resonanceBreach = RotordynamicsVibration.evaluateSeparationMargin({
    criticalSpeedRpm: 5000,
    operatingSpeedRpm: 4800, // only 4% separation, requires ~18%
    amplificationFactor: 3.5
  });
  assert.strictEqual(resonanceBreach.meetsSeparationMargin, false);

  // ISO 20816 Vibration Severity
  const normalVib = RotordynamicsVibration.evaluateVibrationSeverity({
    velocityRmsMmS: 1.8,
    machineGroup: 'GROUP_1',
    supportRigidity: 'RIGID'
  });
  assert.strictEqual(normalVib.severityZone, 'A');
  assert.strictEqual(normalVib.isAlarmActive, false);
  assert.strictEqual(normalVib.isTripActive, false);

  const tripVib = RotordynamicsVibration.evaluateVibrationSeverity({
    velocityRmsMmS: 9.2,
    machineGroup: 'GROUP_1',
    supportRigidity: 'RIGID'
  });
  assert.strictEqual(tripVib.severityZone, 'D');
  assert.strictEqual(tripVib.isTripActive, true);
});

// ============================================================================
// 11. API 614 LUBE OIL & API 692 DRY GAS SEAL TESTS
// ============================================================================
test('LubeSealOilApi614: sizeLubeOilConsole and sizeDryGasSealPanel', () => {
  const lubeConsole = LubeSealOilApi614.sizeLubeOilConsole({
    totalShaftPowerKW: 12000.0, // 12 MW train
    journalBearingCount: 6,
    thrustBearingCount: 2,
    hasGearbox: true,
    oilSupplyTempC: 45.0,
    oilReturnTempC: 62.0
  });

  assert.strictEqual(lubeConsole.standard, 'API 614 (Lubrication, Shaft-Sealing and Control-Oil Systems)');
  assert.ok(lubeConsole.heatDissipation.totalHeatLoadKW > 100.0);
  assert.ok(lubeConsole.oilFlow.normalCirculationFlowLPM > 100.0);
  assert.ok(lubeConsole.oilFlow.ratedPumpCapacityLPM > lubeConsole.oilFlow.normalCirculationFlowLPM);
  assert.strictEqual(lubeConsole.reservoir.retentionTimeMinutes, 8.0);
  assert.ok(lubeConsole.reservoir.totalGrossCapacityLiters > 2000);
  assert.strictEqual(lubeConsole.emergencyRundownTank.rundownDurationMinutes, 3.0);
  assert.ok(lubeConsole.emergencyRundownTank.tankVolumeLiters > 0);
  assert.ok(lubeConsole.emergencyRundownTank.minStaticElevationMeters >= 4.0);
  assert.ok(lubeConsole.duplexCoolers.coolerDesignDutyKW > lubeConsole.heatDissipation.totalHeatLoadKW);

  // API 692 Dry Gas Seal Panel sizing
  const dgsPanel = LubeSealOilApi614.sizeDryGasSealPanel({
    sealCartridgeCount: 2,
    shaftDiameterMm: 150.0,
    referenceGasPressureBarg: 45.0,
    processGasDewPointC: 12.0
  });

  assert.strictEqual(dgsPanel.sealCartridgeCount, 2);
  assert.strictEqual(dgsPanel.primarySealGas.supplyPressureBarg, 48.5); // 45 + 3.5 bar differential
  assert.strictEqual(dgsPanel.primarySealGas.minSupplyTempSuperheatedC, 32.0); // 12 + 20°C superheat
  assert.ok(dgsPanel.leakageMonitoring.normalPrimaryLeakageNm3H > 0);
  assert.ok(dgsPanel.leakageMonitoring.highHighTripThresholdNm3H > dgsPanel.leakageMonitoring.highLeakageAlarmThresholdNm3H);
  assert.ok(dgsPanel.secondaryAndSeparationSeal.nitrogenBufferFlowTotalNm3H > 0);
  assert.strictEqual(dgsPanel.secondaryAndSeparationSeal.separationBarrierDifferentialBar, 0.35);
});

// ============================================================================
// 12. ADVERSARIAL EDGE CASE & THERMODYNAMIC INVARIANT TESTS
// ============================================================================
test('Adversarial: Turboexpander First Law enthalpy conservation during two-phase condensation', () => {
  const deepCryo = Turboexpander.evaluateTurboexpander({
    massFlowKgH: 75000.0,
    inletPressureBarg: 55.0,
    outletPressureBarg: 18.0,
    inletTempC: -40.0,
    molecularWeight: 18.0,
    specificHeatRatioGamma: 1.28,
    expanderEfficiency: 0.86,
    dewPointTempC: -60.0,
    latentHeatKJkg: 390.0
  });

  // 1. Two-phase mixture temperature must fall below dew point
  assert.ok(deepCryo.outletTempC < -60.0, 'Outlet temp must be below dew point during condensation');
  assert.ok(deepCryo.liquidCondensationFractionPct > 0.0);
  assert.strictEqual(deepCryo.isTwoPhaseExpansion, true);

  // 2. Strict First Law energy conservation check: Cp*(Tin - Tout) + x*Hvap == delta_h_act
  const R_spec = (8.314472 * 1000.0) / 18.0;
  const Cp_kJ = ((1.28 * R_spec) / 0.28) * 1e-3;
  const sensibleDropKJ = Cp_kJ * (-40.0 - deepCryo.outletTempC);
  const latentReleasedKJ = (deepCryo.liquidCondensationFractionPct / 100.0) * 390.0;
  const totalFluidEnthalpyLoss = sensibleDropKJ + latentReleasedKJ;

  assert.ok(Math.abs(totalFluidEnthalpyLoss - deepCryo.actualEnthalpyDropKJkg) < 0.2,
    `First Law energy balance mismatch: ${totalFluidEnthalpyLoss} vs ${deepCryo.actualEnthalpyDropKJkg}`);

  // 3. Rejection of invalid recompressor flow
  assert.throws(() => {
    Turboexpander.evaluateTurboexpander({
      massFlowKgH: 50000,
      inletPressureBarg: 30,
      outletPressureBarg: 10,
      inletTempC: 0,
      molecularWeight: 18,
      recompressorMassFlowKgH: -100
    });
  }, /Recompressor mass flow must be positive/);
});

test('Adversarial: Integrally geared compressor 6-stage balanced staging and cold suction behavior', () => {
  // 6-stage compressor from 0 barg to 8 barg with 0.2 bar intercooler drop
  const sixStage = CompressorIntegrallyGearedApi672.evaluateIntegrallyGearedCompressor({
    massFlowKgH: 30000.0,
    suctionPressureBarg: 0.0,
    targetDischargePressureBarg: 8.0,
    suctionTempC: 25.0,
    molecularWeight: 28.96,
    stageCount: 6,
    intercoolerApproachTempC: 35.0,
    intercoolerDeltaPBar: 0.2
  });

  assert.strictEqual(sixStage.stages.length, 6);
  assert.strictEqual(sixStage.stages[5].dischargePressureBarg, 8.0, 'Final stage must hit target discharge pressure');
  // Confirm stage pressure ratios are balanced (no extreme jump on final stage)
  const rcFirst = sixStage.stages[0].stagePressureRatio;
  const rcFinal = sixStage.stages[5].stagePressureRatio;
  assert.ok(Math.abs(rcFinal - rcFirst) / rcFirst < 0.15,
    `Stage pressure ratios must be balanced across stages: stage 1 = ${rcFirst}, stage 6 = ${rcFinal}`);

  // Cold suction (-15°C) with 35°C intercooler approach: cooler duty must NOT be negative
  const coldRun = CompressorIntegrallyGearedApi672.evaluateIntegrallyGearedCompressor({
    massFlowKgH: 20000.0,
    suctionPressureBarg: 1.0,
    targetDischargePressureBarg: 5.0,
    suctionTempC: -15.0,
    molecularWeight: 28.96,
    stageCount: 4,
    intercoolerApproachTempC: 35.0,
    intercoolerDeltaPBar: 0.15
  });

  for (const stg of coldRun.stages) {
    assert.ok(stg.intercoolerDutyKW >= 0.0, 'Intercooler duty must be non-negative');
  }

  // IGV input validation
  assert.throws(() => {
    CompressorIntegrallyGearedApi672.evaluateIgvTurndown({
      ratedMassFlowKgH: -500,
      ratedShaftPowerKW: 1000,
      igvAngleDegrees: 10
    });
  }, /Rated mass flow and shaft power must be positive/);
});

test('Adversarial: Positive displacement pumps turndown accuracy and differential pressure checks', () => {
  // API 675 pump at 5% stroke (below 10% API 675 linearity range)
  const lowStrokePump = PumpApi675Api676.evaluateApi675MeteringPump({
    maxRatedCapacityLPH: 400.0,
    strokeLengthPercent: 5.0, // 5% setting
    strokeSpeedPercent: 100.0,
    suctionPressureBarg: 1.0,
    dischargePressureBarg: 50.0,
    liquidDensityKgM3: 1100.0,
    vaporPressureBara: 0.05,
    suctionPipeLengthM: 5.0,
    suctionPipeInternalDiameterMm: 20.0
  });

  assert.strictEqual(lowStrokePump.strokeLengthSettingPercent, 5.0, 'Setting must retain requested 5%');
  assert.strictEqual(lowStrokePump.qualityMetrics.satisfiesApi675Accuracy, false,
    'Sub-10% stroke must be flagged as outside API 675 accuracy limits');
  assert.ok(lowStrokePump.actualCapacityLPH < 30.0, 'Capacity must reflect actual 5% stroke rather than 10%');

  // API 676 rotary pump with negative differential pressure must throw
  assert.throws(() => {
    PumpApi675Api676.evaluateApi676RotaryPump({
      displacementLitersPerRev: 1.0,
      operatingSpeedRpm: 1200,
      differentialPressureBar: -2.0,
      dynamicViscosityCP: 50.0
    });
  }, /Differential pressure must be positive/);

  // API 675 with zero pipe diameter must throw
  assert.throws(() => {
    PumpApi675Api676.evaluateApi675MeteringPump({
      maxRatedCapacityLPH: 200,
      strokeLengthPercent: 50,
      suctionPressureBarg: 1,
      dischargePressureBarg: 10,
      liquidDensityKgM3: 1000,
      vaporPressureBara: 0.05,
      suctionPipeLengthM: 5,
      suctionPipeInternalDiameterMm: 0
    });
  }, /Suction pipe diameter must be positive/);
});

test('Adversarial: Sealless, slurry, and progressive cavity parameter validations', () => {
  // Sealless pump: non-positive flow rate must throw
  assert.throws(() => {
    PumpSeallessApi685.evaluateSeallessPump({
      flowRateM3H: 0,
      differentialHeadM: 100,
      suctionPressureBarg: 2,
      dischargePressureBarg: 10,
      suctionTempC: 20,
      liquidDensityKgM3: 600,
      vaporPressureAtSuctionTempBara: 1,
      speedRpm: 2950
    });
  }, /Process flow rate must be positive/);

  // Slurry pump: non-positive head must throw
  assert.throws(() => {
    PumpSlurryProgressiveCavity.evaluateSlurryPumpDerating({
      clearWaterFlowRateM3H: 100,
      clearWaterHeadM: -10,
      clearWaterEfficiency: 0.8,
      solidsSpecificGravity: 2.5,
      solidsVolumeFractionCv: 0.15,
      medianParticleDiameterMicrons: 200
    });
  }, /Clean water head must be positive/);

  // PCP: zero speed must throw
  assert.throws(() => {
    PumpSlurryProgressiveCavity.evaluateProgressiveCavityPump({
      rotorDiameterMm: 50,
      eccentricityMm: 8,
      statorPitchMm: 160,
      speedRpm: 0,
      differentialPressureBar: 12
    });
  }, /Operating speed must be positive/);
});

test('Adversarial: Prime movers (steam turbine, gas turbine, motor, vibration, screw compressor)', () => {
  // Steam turbine: feeding subcooled liquid water (150°C at 40 barg) must throw
  assert.throws(() => {
    DriverSteamTurbine.evaluateSteamTurbine({
      inletPressureBarg: 40.0,
      inletTempC: 150.0,
      exhaustPressureBarg: 4.0,
      shaftPowerKW: 2000.0
    });
  }, /subcooled liquid water is prohibited in steam turbines/);

  // Gas turbine: omitted modelKey defaults safely without throwing TypeError
  const defaultGt = DriverGasTurbine.evaluateGasTurbineDriver({});
  assert.strictEqual(defaultGt.standard, 'ISO 2314 Gas Turbine Evaluation');
  assert.ok(defaultGt.powerAndEfficiency.siteAvailablePowerMW > 0);

  // Gas turbine helper: non-positive compressor power demand must throw
  assert.throws(() => {
    DriverGasTurbine.sizeHelperDriver({
      compressorShaftPowerDemandMW: -10
    });
  }, /Compressor shaft power demand must be positive/);

  // Electric motor: zero voltage must throw
  assert.throws(() => {
    DriverElectricMotor.evaluateElectricMotor({
      shaftPowerDemandKW: 500,
      supplyVoltageV: 0
    });
  }, /Supply voltage must be positive/);

  // Electric motor: invalid pole count must throw
  assert.throws(() => {
    DriverElectricMotor.evaluateElectricMotor({
      shaftPowerDemandKW: 500,
      poleCount: 3
    });
  }, /Pole count must be an even positive integer/);

  // Rotordynamics: negative vibration velocity must throw
  assert.throws(() => {
    RotordynamicsVibration.evaluateVibrationSeverity({
      velocityRmsMmS: -2.0
    });
  }, /Vibration velocity cannot be negative/);

  // Rotordynamics: verify API 670 displacement limit with 50.8 µm cap
  const probeAudit = RotordynamicsVibration.evaluateVibrationSeverity({
    velocityRmsMmS: 2.0,
    shaftDisplacementPeakToPeakMicrons: 35.0,
    operatingSpeedRpm: 3000
  });
  assert.strictEqual(probeAudit.shaftDisplacementEvaluation.meetsApi670Displacement, true);
  assert.ok(probeAudit.shaftDisplacementEvaluation.api670AllowableMicrons > 25.4);

  // Screw compressor: gamma <= 1.0 must throw
  assert.throws(() => {
    CompressorScrewApi619.evaluateScrewCompressor({
      massFlowKgH: 10000,
      suctionPressureBarg: 1.0,
      dischargePressureBarg: 5.0,
      suctionTempC: 25.0,
      molecularWeight: 28.0,
      specificHeatRatioGamma: 1.0
    });
  }, /Specific heat ratio gamma must exceed 1.0/);

  // Screw compressor: zero slide valve power must throw
  assert.throws(() => {
    CompressorScrewApi619.evaluateSlideValveTurndown({
      fullLoadShaftPowerKW: 0,
      fullLoadCapacityM3H: 1000,
      slideValvePositionPercent: 50
    });
  }, /Full load power and capacity must be positive/);
});
