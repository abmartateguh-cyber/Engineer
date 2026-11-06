'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VALVE_TAXONOMY_CATALOG,
  ControlValveNoiseIec60534,
  MultiphaseChoke,
  TankBreathingApi2000,
  RuptureDiscAndPsvHydraulics,
  PlantEngineeringMasterApi
} = require('../src/core/plant/plant_engineering_master_api');

test('Phase 3 Valve Taxonomy Expansion Completeness', () => {
  const keys = Object.keys(VALVE_TAXONOMY_CATALOG);

  // 1. Gate valves (API 6D)
  assert.ok(keys.includes('gate_through_conduit'), 'Through-conduit slab gate present');
  assert.ok(keys.includes('gate_expanding_api6d'), 'Expanding gate valve present');
  const expGate = VALVE_TAXONOMY_CATALOG.gate_expanding_api6d;
  assert.equal(expGate.category, 'Isolation');
  assert.equal(expGate.standard, 'API 6D / ISO 14313');

  // 2. Diaphragm valves (MSS SP-88)
  assert.ok(keys.includes('diaphragm_weir_mss_sp88'), 'Weir diaphragm valve present');
  assert.ok(keys.includes('diaphragm_straight_through_mss_sp88'), 'Straight-through diaphragm valve present');
  const weir = VALVE_TAXONOMY_CATALOG.diaphragm_weir_mss_sp88;
  assert.ok(weir.recoveryFactorFL >= 0.70);

  // 3. Pinch valve (slurry/corrosive)
  assert.ok(keys.includes('pinch_valve_slurry'), 'Slurry pinch valve present');
  const pinch = VALVE_TAXONOMY_CATALOG.pinch_valve_slurry;
  assert.match(pinch.typicalServices, /slurry/i);

  // 4. Needle & instrument manifold valves
  assert.ok(keys.includes('needle_valve_instrument'), 'Needle valve present');
  assert.ok(keys.includes('manifold_instrument_valve'), 'Instrument manifold present');

  // 5. Knife gate valve (MSS SP-81)
  assert.ok(keys.includes('knife_gate_mss_sp81'), 'Knife gate valve present');
  assert.equal(VALVE_TAXONOMY_CATALOG.knife_gate_mss_sp81.category, 'Isolation');

  // 6. High-pressure multiphase choke (API 6A)
  assert.ok(keys.includes('choke_multiphase_api6a'), 'API 6A multiphase choke present');

  // 7. Subsea fail-safe gate & ball (API 17D / ISO 13628-4)
  assert.ok(keys.includes('subsea_failsafe_gate_api17d'), 'Subsea fail-safe gate present');
  assert.ok(keys.includes('subsea_ball_valve_api17d'), 'Subsea ball valve present');
  assert.equal(VALVE_TAXONOMY_CATALOG.subsea_failsafe_gate_api17d.category, 'Subsea Isolation');

  // 8. PVRV (API 2000)
  assert.ok(keys.includes('pvrv_breather_api2000'), 'API 2000 PVRV present');
  assert.equal(VALVE_TAXONOMY_CATALOG.pvrv_breather_api2000.category, 'Safety/Relief');

  // 9. Rupture disc (ASME Sec VIII / API 520)
  assert.ok(keys.includes('rupture_disc_asme_api520'), 'Rupture disc present');

  // 10. Axial flow control / nozzle check
  assert.ok(keys.includes('axial_flow_control_valve'), 'Axial flow control valve present');
  assert.ok(keys.includes('check_axial_nozzle_nonslam'), 'Axial nozzle check present');
});

test('IEC 60534-8-3 Aerodynamic Noise Prediction & Multi-Stage Trim Recommendation', () => {
  // Scenario A: Moderate pressure drop (subsonic / low noise < 85 dBA)
  const lowNoise = ControlValveNoiseIec60534.predictAerodynamicNoise({
    massFlowKgH: 2500.0,
    inletPressureBarg: 6.0,
    outletPressureBarg: 5.2,
    inletTempC: 25.0,
    molecularWeight: 18.0,
    specificHeatRatioGamma: 1.30,
    pipeDiameterMm: 150.0,
    pipeWallThicknessMm: 7.11
  });

  assert.equal(lowNoise.isChoked, false);
  assert.equal(lowNoise.noiseExceedsLimit, false);
  assert.ok(lowNoise.soundPressureLevelLpADbA < 85.0);
  assert.equal(lowNoise.trimRecommendation, null);

  // Scenario B: High pressure letdown (>100 bar deltaP -> severe noise > 100 dBA)
  const severeNoise = ControlValveNoiseIec60534.predictAerodynamicNoise({
    massFlowKgH: 120000.0,
    inletPressureBarg: 120.0,
    outletPressureBarg: 5.0,
    inletTempC: 35.0,
    molecularWeight: 19.5,
    specificHeatRatioGamma: 1.28,
    pipeDiameterMm: 200.0,
    pipeWallThicknessMm: 8.18
  });

  assert.equal(severeNoise.isChoked, true);
  assert.equal(severeNoise.noiseExceedsLimit, true);
  assert.ok(severeNoise.mechanicalStreamPowerWm > 1e6, 'Mechanical power > 1 MW');
  assert.ok(severeNoise.soundPressureLevelLpADbA > 95.0, 'Noise exceeds 95 dBA');
  assert.ok(severeNoise.trimRecommendation !== null);
  assert.ok(severeNoise.trimRecommendation.numberOfStages >= 3);
  assert.ok(severeNoise.trimRecommendation.predictedAttenuatedLpADbA <= 85.0);
});

test('IEC 60534-8-4 Hydrodynamic Cavitation & Liquid Noise', () => {
  // Scenario A: Non-cavitating subcritical liquid
  const normalLiquid = ControlValveNoiseIec60534.predictHydrodynamicNoise({
    flowRateM3H: 150.0,
    inletPressureBarg: 15.0,
    outletPressureBarg: 12.0,
    vaporPressureBarg: 0.05,
    densityKgM3: 998.0,
    valveRecoveryFactorFL: 0.90
  });

  assert.equal(normalLiquid.cavitationRisk, false);
  assert.equal(normalLiquid.noiseExceedsLimit, false);
  assert.ok(normalLiquid.soundPressureLevelLpADbA < 75.0);

  // Scenario B: Severe choked cavitation (high delta-P letdown)
  const severeCav = ControlValveNoiseIec60534.predictHydrodynamicNoise({
    flowRateM3H: 250.0,
    inletPressureBarg: 80.0,
    outletPressureBarg: 2.0,
    vaporPressureBarg: 0.20,
    densityKgM3: 1000.0,
    valveRecoveryFactorFL: 0.85,
    distanceM: 2.0
  });

  assert.equal(severeCav.cavitationRisk, true);
  assert.equal(severeCav.isChokedCavitation, true);
  assert.ok(severeCav.differentialPressureRatioXF > 0.90, 'xF approaches 1.0 under severe letdown');
  assert.ok(severeCav.incipientRatioXFz > 0.0);
  assert.ok(severeCav.peakFrequencyHz >= 100 && severeCav.peakFrequencyHz <= 8000);
  assert.ok(severeCav.trimRecommendation !== null);
  assert.ok(severeCav.trimRecommendation.numberOfStages >= 2);
  assert.match(severeCav.trimRecommendation.recommendedTrim, /anti-cavitation/i);

  // Scenario C: Zero / adverse pressure drop returns baseline noise
  const noFlowLiquid = ControlValveNoiseIec60534.predictHydrodynamicNoise({
    flowRateM3H: 0.0,
    inletPressureBarg: 10.0,
    outletPressureBarg: 10.0,
    vaporPressureBarg: 0.05
  });
  assert.equal(noFlowLiquid.soundPressureLevelLpADbA, 30.0);
  assert.equal(noFlowLiquid.cavitationRisk, false);
});

test('Sachdeva Multiphase Choke Model & Gilbert Empirical Correlation', () => {
  // 1. Sachdeva Forward Calculation
  const chokeFlow = MultiphaseChoke.calculateSachdevaFlow({
    upstreamPressureBarg: 100.0,
    downstreamPressureBarg: 30.0,
    gasMassFraction: 0.25, // 25% gas, 75% liquid by mass
    beanSize64th: 32.0, // 32/64" = 1/2" bean
    temperatureC: 45.0,
    liquidDensityKgM3: 820.0,
    gasMolecularWeight: 21.0
  });

  assert.equal(chokeFlow.isChoked, true, 'High pressure drop ratio results in critical choked flow');
  assert.ok(chokeFlow.criticalPressureRatioEtaC >= 0.50 && chokeFlow.criticalPressureRatioEtaC <= 0.80);
  assert.ok(chokeFlow.massFluxKgSM2 > 1000.0);
  assert.ok(chokeFlow.totalMassFlowKgH > 500.0);
  assert.ok(chokeFlow.liquidFlowRateBPD > 0.0);
  assert.ok(chokeFlow.gasFlowRateSm3D > 0.0);

  // 2. Sachdeva Sizing Calculation
  const sized = MultiphaseChoke.sizeSachdevaBean({
    targetTotalMassFlowKgH: 25000.0,
    upstreamPressureBarg: 120.0,
    downstreamPressureBarg: 40.0,
    gasMassFraction: 0.20,
    temperatureC: 50.0,
    liquidDensityKgM3: 840.0,
    gasMolecularWeight: 20.5
  });

  assert.ok(sized.selectedBeanSize64th > 10);
  assert.ok(sized.selectedDiameterMm > 0.0);
  assert.ok(sized.ratedMassFlowKgH >= sized.targetMassFlowKgH * 0.95);

  // 3. Gilbert Empirical Correlation
  const gilbertPwh = MultiphaseChoke.calculateGilbert({
    correlation: 'gilbert',
    liquidRateBPD: 2500.0,
    gasLiquidRatioMscfBbl: 1.5,
    beanSize64th: 28.0
  });

  assert.ok(gilbertPwh.wellheadPressureBarg > 10.0);
  assert.ok(gilbertPwh.wellheadPressurePsia > 150.0);

  // Solve for bean size using Baxendell
  const baxendellBean = MultiphaseChoke.calculateGilbert({
    correlation: 'baxendell',
    wellheadPressureBarg: gilbertPwh.wellheadPressureBarg,
    liquidRateBPD: 2500.0,
    gasLiquidRatioMscfBbl: 1.5
  });

  assert.ok(Math.abs(baxendellBean.beanSize64th - 28.0) < 5.0, 'Baxendell bean matches within reasonable empirical tolerance');

  // 4. Gilbert with direct PSIA input
  const directPsia = MultiphaseChoke.calculateGilbert({
    correlation: 'gilbert',
    wellheadPressurePsia: 500.0,
    liquidRateBPD: 2000.0,
    gasLiquidRatioScfBbl: 800.0
  });
  assert.ok(directPsia.beanSize64th > 0.0);
  assert.equal(directPsia.wellheadPressurePsia, 500.0);

  // 5. Sachdeva Adverse Pressure Gradient (Zero Flow)
  const zeroFlow = MultiphaseChoke.calculateSachdevaFlow({
    upstreamPressureBarg: 20.0,
    downstreamPressureBarg: 40.0, // P1 < P2
    gasMassFraction: 0.30,
    beanSize64th: 32.0
  });
  assert.equal(zeroFlow.totalMassFlowKgH, 0.0);
  assert.equal(zeroFlow.massFluxKgSM2, 0.0);
});

test('API 2000 Storage Tank Breathing & Emergency Fire Venting', () => {
  // 1. Normal Thermal & Liquid Breathing (API 2000 7th Edition)
  const normalBreathing = TankBreathingApi2000.calculateNormalBreathing({
    tankCapacityM3: 50000.0, // 50,000 m3 storage tank
    pumpInRateM3H: 1500.0,
    pumpOutRateM3H: 1200.0,
    isVolatileLiquid: true, // LNG or light hydrocarbon condensate
    latitudeDegrees: 25.0,
    isInsulated: true,
    insulationThicknessMm: 100.0,
    insulationConductivityWmK: 0.04,
    tankDiameterM: 45.0,
    tankHeightM: 32.0
  });

  assert.ok(normalBreathing.inbreathing.totalRequiredNm3H > 1000.0);
  assert.ok(normalBreathing.outbreathing.totalRequiredNm3H > 3000.0);
  assert.ok(normalBreathing.insulationReductionFactorRi < 1.0, 'Insulation reduces thermal breathing load');
  assert.match(normalBreathing.recommendedPvrvSize, /12"|Dual|Multi/);

  // 1.1 Verify insulation thickness monotonicity: thicker insulation gives smaller Ri (better insulation)
  const thinInsulation = TankBreathingApi2000.calculateNormalBreathing({
    tankCapacityM3: 50000.0,
    pumpInRateM3H: 0,
    pumpOutRateM3H: 0,
    isVolatileLiquid: true,
    latitudeDegrees: 25.0,
    isInsulated: true,
    insulationThicknessMm: 10.0, // thin 10mm
    insulationConductivityWmK: 0.04
  });
  const thickInsulation = TankBreathingApi2000.calculateNormalBreathing({
    tankCapacityM3: 50000.0,
    pumpInRateM3H: 0,
    pumpOutRateM3H: 0,
    isVolatileLiquid: true,
    latitudeDegrees: 25.0,
    isInsulated: true,
    insulationThicknessMm: 100.0, // thick 100mm
    insulationConductivityWmK: 0.04
  });
  assert.ok(
    thickInsulation.insulationReductionFactorRi < thinInsulation.insulationReductionFactorRi,
    'Thicker insulation must yield smaller Ri reduction factor'
  );

  // 1.2 Verify volatile fluid factor C = 0.50 vs non-volatile C = 0.32
  const nonVolatile = TankBreathingApi2000.calculateNormalBreathing({
    tankCapacityM3: 50000.0,
    pumpInRateM3H: 0,
    pumpOutRateM3H: 0,
    isVolatileLiquid: false,
    latitudeDegrees: 25.0,
    isInsulated: false
  });
  const volatile = TankBreathingApi2000.calculateNormalBreathing({
    tankCapacityM3: 50000.0,
    pumpInRateM3H: 0,
    pumpOutRateM3H: 0,
    isVolatileLiquid: true,
    latitudeDegrees: 25.0,
    isInsulated: false
  });
  assert.ok(
    volatile.inbreathing.thermalWeatherNm3H > nonVolatile.inbreathing.thermalWeatherNm3H,
    'Volatile fluid has higher thermal inbreathing demand per API 2000 Table 2'
  );

  // 2. Emergency Fire Venting
  const fireVenting = TankBreathingApi2000.calculateEmergencyFireVenting({
    tankGeometry: 'vertical_cylinder',
    tankDiameterM: 45.0,
    tankHeightM: 32.0,
    latentHeatOfVaporizationJPerKg: 510000.0, // LNG methane latent heat (510 kJ/kg)
    relievingTemperatureC: -160.0,
    molecularWeight: 16.04,
    isElevated: true,
    environmentalFactorF: 0.15, // High-performance cryogenic insulation credit
    normalVentingCreditNm3H: normalBreathing.outbreathing.totalRequiredNm3H
  });

  assert.ok(fireVenting.wettedSurfaceAreaM2 > 1000.0);
  assert.ok(fireVenting.netHeatInputMw > 0.5);
  assert.ok(fireVenting.totalEmergencyAirEquivalentNm3H > 10000.0);
  assert.match(fireVenting.recommendedEmergencyDevice, /Emergency|Hatch|Manhole/i);
});

test('API 520 Part II PSV Installation Hydraulics & Combination Rupture Disc', () => {
  // 1. 3% Inlet Piping Pressure Loss Rule
  // 1.1 Passing case: short 4" inlet run, rounded entrance
  const passingInlet = RuptureDiscAndPsvHydraulics.checkInletPressureLoss({
    setPressureBarg: 40.0,
    reliefRateKgH: 25000.0,
    fluidDensityKgM3: 25.0, // Dense supercritical / vapor
    inletPipeDiameterMm: 100.0, // 4" bore
    inletPipeLengthM: 1.5,
    entranceType: 'rounded',
    hasUpstreamRuptureDisc: false
  });

  assert.equal(passingInlet.meets3PercentRule, true);
  assert.equal(passingInlet.chatterRisk, false);
  assert.ok(passingInlet.lossPercentageOfSetPressure < 3.0);

  // 1.2 Inward projecting entrance (Borda)
  const bordaInlet = RuptureDiscAndPsvHydraulics.checkInletPressureLoss({
    setPressureBarg: 40.0,
    reliefRateKgH: 25000.0,
    fluidDensityKgM3: 25.0,
    inletPipeDiameterMm: 100.0,
    inletPipeLengthM: 1.5,
    entranceType: 'inward_projecting'
  });
  assert.equal(bordaInlet.kLossBreakdown.entranceK, 0.78);

  // 1.3 Failing case: long 2" inlet run, square entrance, high velocity -> Chatter risk
  const failingInlet = RuptureDiscAndPsvHydraulics.checkInletPressureLoss({
    setPressureBarg: 30.0,
    reliefRateKgH: 30000.0,
    fluidDensityKgM3: 20.0,
    inletPipeDiameterMm: 50.0, // Undersized 2" bore
    inletPipeLengthM: 8.0, // Long 8 m run
    entranceType: 'sharp_square',
    fittingsResistanceK: 1.8
  });

  assert.equal(failingInlet.meets3PercentRule, false);
  assert.equal(failingInlet.chatterRisk, true);
  assert.ok(failingInlet.lossPercentageOfSetPressure > 3.0);
  assert.ok(failingInlet.recommendations.some(r => /chatter/i.test(r)));

  // 2. Discharge Backpressure Limits
  const conventionalPass = RuptureDiscAndPsvHydraulics.checkDischargeBackpressure({
    psvType: 'conventional',
    setPressureBarg: 50.0,
    builtUpBackpressureBarg: 3.5 // 7% < 10%
  });
  assert.equal(conventionalPass.isAcceptable, true);

  // Conventional valve with variable superimposed backpressure must fail per API 520 Part I
  const conventionalVarSuper = RuptureDiscAndPsvHydraulics.checkDischargeBackpressure({
    psvType: 'conventional',
    setPressureBarg: 50.0,
    builtUpBackpressureBarg: 2.0,
    superimposedBackpressureBarg: 2.0,
    isVariableSuperimposed: true
  });
  assert.equal(conventionalVarSuper.isAcceptable, false);
  assert.match(conventionalVarSuper.recommendations[0], /variable/i);

  const conventionalFail = RuptureDiscAndPsvHydraulics.checkDischargeBackpressure({
    psvType: 'conventional',
    setPressureBarg: 50.0,
    builtUpBackpressureBarg: 8.0 // 16% > 10% limit
  });
  assert.equal(conventionalFail.isAcceptable, false);

  const bellowsPass = RuptureDiscAndPsvHydraulics.checkDischargeBackpressure({
    psvType: 'balanced_bellows',
    setPressureBarg: 50.0,
    builtUpBackpressureBarg: 15.0 // 30% <= 50% limit
  });
  assert.equal(bellowsPass.isAcceptable, true);

  // 3. Reaction Force at Atmospheric Vent Stack
  // 3.1 Choked exit flow
  const reaction = RuptureDiscAndPsvHydraulics.calculateReactionForce({
    reliefRateKgH: 80000.0,
    molecularWeight: 18.0,
    relievingTemperatureC: 40.0,
    specificHeatRatioGamma: 1.30,
    dischargeExitDiameterMm: 150.0,
    dynamicLoadFactor: 2.0
  });

  assert.equal(reaction.isSonicChokedAtExit, true);
  assert.ok(reaction.totalSteadyStateForceN > 1000.0);
  assert.ok(reaction.designStructuralRestraintForceN >= reaction.totalSteadyStateForceN * 2.0);
  assert.ok(reaction.designStructuralRestraintForceLbf > 0.0);

  // 3.2 Unchoked exit flow
  const unchokedReaction = RuptureDiscAndPsvHydraulics.calculateReactionForce({
    reliefRateKgH: 500.0, // Low flow
    molecularWeight: 28.0,
    relievingTemperatureC: 25.0,
    dischargeExitDiameterMm: 200.0
  });
  assert.equal(unchokedReaction.isSonicChokedAtExit, false);
  assert.equal(unchokedReaction.exitStaticPressureBarg, 0.0);

  // 4. Combination Rupture Disc + PSV Device
  const combination = RuptureDiscAndPsvHydraulics.evaluateCombinationDevice({
    psvSetPressureBarg: 50.0,
    discMarkedBurstPressureBarg: 50.0,
    requiredReliefAreaMm2: 1500.0,
    discType: 'reverse_buckling',
    hasInterspacePressureTelltale: true,
    operatingPressureBarg: 42.0 // 42 / 50 = 84% <= 95%
  });

  assert.equal(combination.combinationFactorKc, 0.90);
  assert.ok(combination.correctedRequiredAreaMm2 > combination.uncorrectedRequiredAreaMm2);
  assert.equal(combination.isNonFragmenting, true);
  assert.equal(combination.isFullyApproved, true);
});

test('PlantEngineeringMasterApi Valve Integration Registry', () => {
  const masterValves = PlantEngineeringMasterApi.valves;
  assert.ok(masterValves.catalog !== undefined);
  assert.ok(masterValves.controlValveSizing !== undefined);
  assert.ok(masterValves.reliefValveSizing !== undefined);
  assert.ok(masterValves.actuatorDynamics !== undefined);
  assert.ok(masterValves.controlValveNoise !== undefined);
  assert.ok(masterValves.multiphaseChoke !== undefined);
  assert.ok(masterValves.tankBreathing !== undefined);
  assert.ok(masterValves.ruptureDiscAndPsvHydraulics !== undefined);
});
