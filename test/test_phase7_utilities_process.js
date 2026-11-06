'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CoolingWaterSystems,
  SteamCondensateBalance,
  InstrumentAirNitrogenSystems,
  FuelGasConditioningSystem,
  WaterTreatmentSystems
} = require('../src/core/plant/utilities');

const {
  ClausSulfurRecoveryUnit,
  AmineTreatingUnit,
  LngRegasVaporizers,
  AirCoolerApi661,
  FiredHeaterApi560
} = require('../src/core/plant/process');

const { PlantEngineeringMasterApi } = require('../src/core/plant/plant_engineering_master_api');

test('CoolingWaterSystems: Cooling Tower Merkel Rating, Water Balance & Seawater Chlorination', () => {
  // 1. Mechanical Draft Cooling Tower
  const ctReport = CoolingWaterSystems.evaluateCoolingTower({
    waterFlowM3H: 35000.0,
    hotWaterTempC: 42.0,
    coldWaterTempC: 32.0,
    wetBulbTempC: 28.0,
    cyclesOfConcentration: 4.0,
    liquidToGasRatio: 1.25,
    driftLossPercent: 0.005
  });

  assert.strictEqual(ctReport.rangeC, 10.0, 'Range = 42 - 32 = 10 C');
  assert.strictEqual(ctReport.approachC, 4.0, 'Approach = 32 - 28 = 4 C');
  assert.ok(ctReport.heatDutyMW > 380.0, 'Heat duty exceeds 380 MW');
  assert.ok(ctReport.merkelNumber > 1.2 && ctReport.merkelNumber < 3.5, 'Merkel KaV/L within standard cooling tower design range');
  assert.ok(ctReport.waterBalance.evaporationLossM3H > 500.0);
  assert.ok(ctReport.waterBalance.makeupWaterRequiredM3H > ctReport.waterBalance.evaporationLossM3H);
  assert.strictEqual(ctReport.waterBalance.cyclesOfConcentration, 4.0);
  assert.ok(ctReport.powerConsumption.totalFanPowerKW > 500.0);

  // 2. Once-Through Seawater Cooling & Electrochlorination
  const swReport = CoolingWaterSystems.evaluateSeawaterCooling({
    heatDutyMW: 280.0,
    seawaterInletTempC: 25.0,
    maxAllowableDeltaTC: 5.0,
    continuousChlorineDosePpm: 1.5,
    shockChlorineDosePpm: 5.0
  });

  assert.strictEqual(swReport.seawaterDeltaTC, 5.0);
  assert.strictEqual(swReport.seawaterDischargeTempC, 30.0);
  assert.strictEqual(swReport.isThermalDischargeAcceptable, true, 'Delta T <= 5.0 C satisfies environmental limits');
  assert.ok(swReport.seawaterFlowRateM3H > 40000.0);
  assert.ok(swReport.electrochlorination.continuousCl2DemandKgH > 50.0);
  assert.ok(swReport.electrochlorination.continuousDcPowerKW > 250.0);
  assert.ok(swReport.electrochlorination.minimumDilutionAirFlowNm3H > swReport.electrochlorination.hydrogenEvolutionRateNm3H * 50);
});

test('SteamCondensateBalance: Multi-Pressure Steam Hierarchy, PRDS & Deaerator BFW Balance', () => {
  const balance = SteamCondensateBalance.evaluateNetworkBalance({
    producers: [
      { header: 'HP', flowKgH: 180000.0, source: 'GT Exhaust HRSG Steam' },
      { header: 'MP', flowKgH: 25000.0, source: 'Auxiliary Package Boiler' },
      { header: 'LP', flowKgH: 10000.0, source: 'Sulfur Plant WHB LP Drum' }
    ],
    consumers: [
      { header: 'HP', flowKgH: 95000.0, user: 'Main Propane Compressor Steam Turbine' },
      { header: 'MP', flowKgH: 85000.0, user: 'Process Reboilers & Heavy Drives' },
      { header: 'LP', flowKgH: 20000.0, user: 'Trace Heating & Tank Coils' }
    ],
    boilerBlowdownPercent: 2.0,
    condensateReturnRatePercent: 82.0
  });

  // Verify HP -> MP letdown occurred due to excess HP generation (180k - 95k = 85k excess)
  assert.ok(balance.prdsLetdownStations[0].inletSteamKgH > 0);
  assert.ok(balance.prdsLetdownStations[0].sprayWaterKgH > 0, 'Desuperheating spray added to letdown');
  assert.ok(balance.prdsLetdownStations[0].outletSteamKgH > balance.prdsLetdownStations[0].inletSteamKgH);

  // Deaerator BFW, makeup, and mass conservation
  assert.ok(balance.deaeratorAndBfw.totalBfwDemandKgH > balance.deaeratorAndBfw.totalSteamGeneratedKgH, 'BFW includes blowdown and spray');
  assert.ok(balance.deaeratorAndBfw.demineralizedWaterMakeupKgH > 0);
  assert.ok(balance.deaeratorAndBfw.deaeratorPeggingSteamLPKgH > 0, 'Deaerator draws LP heating steam');
  assert.strictEqual(balance.deaeratorAndBfw.deaeratorOperatingTempC, 105.0);

  // Exact simultaneous mass conservation in deaerator: m_cond + m_makeup + m_da_steam == m_BFW
  const totalWaterInDeaerator = balance.deaeratorAndBfw.condensateReturnedKgH +
    balance.deaeratorAndBfw.demineralizedWaterMakeupKgH +
    balance.deaeratorAndBfw.deaeratorPeggingSteamLPKgH;
  assert.ok(
    Math.abs(totalWaterInDeaerator - balance.deaeratorAndBfw.totalBfwDemandKgH) <= 1.0,
    `Deaerator mass must be conserved: In=${totalWaterInDeaerator} kg/h vs Out=${balance.deaeratorAndBfw.totalBfwDemandKgH} kg/h`
  );
});

test('InstrumentAirNitrogenSystems: Air Package Sizing & High-Purity Nitrogen Storage', () => {
  // 1. Air Package
  const airPkg = InstrumentAirNitrogenSystems.sizeAirPackage({
    continuousInstrumentAirNm3H: 1500.0,
    intermittentInstrumentAirNm3H: 400.0,
    plantUtilityAirNm3H: 500.0,
    supplyPressureBarg: 7.5,
    minimumInstrumentPressureBarg: 4.5,
    holdupTimeMinutes: 20,
    dryerType: 'heatless'
  });

  assert.strictEqual(airPkg.dryer.targetPressureDewPointC, -40.0);
  assert.ok(airPkg.dryer.purgeAirLossNm3H > 0);
  assert.ok(airPkg.compressor.freeAirDeliveryM3Min > 30.0);
  assert.ok(airPkg.compressor.estimatedShaftPowerKW > 150.0);
  assert.ok(airPkg.receiverVessel.calculatedVolumeM3 > 50.0, 'Receiver must hold 20 min demand');

  // Input validation
  assert.throws(() => {
    InstrumentAirNitrogenSystems.sizeAirPackage({ continuousInstrumentAirNm3H: 100, holdupTimeMinutes: -5 });
  }, /holdupTimeMinutes must be positive/);

  // 2. Nitrogen Package
  const n2Pkg = InstrumentAirNitrogenSystems.sizeNitrogenPackage({
    lngTankBlanketingNm3H: 350.0,
    dryGasSealBufferNm3H: 180.0,
    flarePurgeNm3H: 120.0,
    intermittentPurgeNm3H: 600.0,
    storageAutonomyDays: 10
  });

  assert.strictEqual(n2Pkg.continuousDemandNm3H, 650.0);
  assert.strictEqual(n2Pkg.peakDemandNm3H, 1250.0);
  assert.ok(n2Pkg.liquidNitrogenBackup.cryogenicTankVolumeM3 > 200.0, 'Liquid N2 tank for 10-day autonomy');

  assert.throws(() => {
    InstrumentAirNitrogenSystems.sizeNitrogenPackage({
      lngTankBlanketingNm3H: 100,
      dryGasSealBufferNm3H: 50,
      flarePurgeNm3H: 50,
      storageAutonomyDays: 0
    });
  }, /storageAutonomyDays must be positive/);
});

test('FuelGasConditioningSystem: ISO 6976 Wobbe Index, Superheat Margin & Scrubber Sizing', () => {
  const fuelComp = {
    CH4: 91.5,
    C2H6: 5.5,
    C3H8: 1.5,
    iC4H10: 0.3,
    nC4H10: 0.2,
    N2: 0.8,
    CO2: 0.2
  };

  const fuelCond = FuelGasConditioningSystem.sizeConditioningPackage({
    compositionMolPct: fuelComp,
    massFlowKgH: 18500.0,
    inletPressureBarg: 45.0,
    deliveryPressureBarg: 28.0,
    inletTempC: 35.0,
    minRequiredSuperheatC: 20.0
  });

  const { combustionProperties, thermalDewPointAnalysis, preheaterSizing, scrubberVessel } = fuelCond;

  // Wobbe metrics
  assert.ok(combustionProperties.wobbeIndexMJNm3 > 45.0 && combustionProperties.wobbeIndexMJNm3 < 53.0);
  assert.strictEqual(combustionProperties.isWobbeAcceptable, true);
  assert.ok(combustionProperties.specificGravity > 0.55 && combustionProperties.specificGravity < 0.65);

  // Superheat and JT cooling (0.50 C/bar per GPSA)
  assert.ok(
    thermalDewPointAnalysis.jouleThomsonCoolingDeltaTC >= 7.0 &&
    thermalDewPointAnalysis.jouleThomsonCoolingDeltaTC <= 10.0,
    'JT cooling for 17 bar drop is ~ 8.5 C per GPSA'
  );
  assert.strictEqual(thermalDewPointAnalysis.isSuperheatAdequate, true);
  // Warm 35 C inlet gas is already 35.5 C above dew point after 8.5 C JT cooling, requiring 0 kW preheat
  assert.strictEqual(preheaterSizing.heaterDutyKW, 0);

  // Cold inlet gas scenario (5 C) where preheater is actively required to achieve 20 C margin
  const coldFeedCond = FuelGasConditioningSystem.sizeConditioningPackage({
    compositionMolPct: fuelComp,
    massFlowKgH: 18500.0,
    inletPressureBarg: 45.0,
    deliveryPressureBarg: 28.0,
    inletTempC: 5.0,
    minRequiredSuperheatC: 20.0
  });
  assert.ok(coldFeedCond.preheaterSizing.heaterDutyKW > 100.0, 'Preheater sized when incoming gas is cold');
  assert.strictEqual(coldFeedCond.thermalDewPointAnalysis.isSuperheatAdequate, true);

  // Scrubber vessel sizing
  assert.ok(scrubberVessel.minimumVesselDiameterMm >= 450);
});

test('WaterTreatmentSystems: SWRO Desalination, Sour Water Stripping & NFPA 20 Firewater', () => {
  // 1. SWRO Desalination with Isobaric Energy Recovery
  const swro = WaterTreatmentSystems.sizeSwroDesalination({
    permeateFlowM3H: 120.0,
    seawaterSalinityTdsMgL: 38000,
    recoveryRatio: 0.42,
    feedPressureBarg: 65.0,
    erdEfficiency: 0.96
  });

  assert.strictEqual(swro.recoveryPercent, 42.0);
  assert.ok(swro.feedFlowM3H > 250.0);
  assert.ok(swro.energyBalance.erdPowerSavingsKW > 300.0, 'Isobaric PX recovers significant energy from high-pressure reject brine');
  assert.ok(swro.energyBalance.specificEnergyConsumptionKWhM3 < 3.5, 'SWRO SEC < 3.5 kWh/m3 with ERD');

  // 2. Sour Water Stripper & API Separator
  const ww = WaterTreatmentSystems.evaluateWastewaterTreatment({
    sourWaterFlowM3H: 45.0,
    inletH2sPpmw: 3200,
    inletNh3Ppmw: 2400,
    oilyWaterFlowM3H: 150.0
  });

  assert.ok(ww.sourWaterStripper.strippingSteamDemandKgH > 5000.0);
  assert.ok(ww.apiOilWaterSeparator.minimumBasinSurfaceAreaM2 > 15.0);

  // 3. NFPA 20 Firewater System
  const fire = WaterTreatmentSystems.sizeFirewaterPackage({
    maxSingleRiskDemandM3H: 2200.0,
    autonomyHours: 4.0,
    ringMainPressureBarg: 11.0
  });

  assert.strictEqual(fire.reservoirStorage.totalDedicatedVolumeM3, 8800);
  assert.strictEqual(fire.pumpStationConfiguration.mainElectricFirePump.flowM3H, 2200.0);
  assert.strictEqual(fire.pumpStationConfiguration.backupDieselFirePump.flowM3H, 2200.0);
  assert.ok(fire.pumpStationConfiguration.mainElectricFirePump.motorRatingKW > 800.0);
});

test('ClausSulfurRecoveryUnit: Thermal Furnace Equilibrium, WHB, Catalytic Stages & SCOT TGTU', () => {
  // 1. Reaction Furnace & WHB
  const furnace = ClausSulfurRecoveryUnit.evaluateReactionFurnace({
    h2sKmolH: 120.0,
    co2KmolH: 80.0,
    nh3KmolH: 15.0,
    hydrocarbonsKmolH: 1.0,
    moistureKmolH: 5.0
  });

  assert.ok(furnace.reactionFurnace.furnaceOperatingTempC >= 1050.0, 'Furnace operating temperature >= 1050 C for NH3 destruction');
  assert.strictEqual(furnace.reactionFurnace.isAmmoniaDestructionAdequate, true);
  assert.ok(furnace.wasteHeatBoiler.hpSteamGenerated42BargKgH > 8000.0);

  // 2. Complete Claus Train with SCOT Tail Gas Unit
  const sruTrain = ClausSulfurRecoveryUnit.evaluateClausTrain({
    acidGasH2sKgH: 4200.0,
    catalyticStagesCount: 2,
    includeScotTgtu: true
  });

  assert.ok(sruTrain.clausOnlyRecoveryPercent > 94.0 && sruTrain.clausOnlyRecoveryPercent < 97.0, '2-stage Claus achieves 95-96% recovery');
  assert.ok(sruTrain.overallSulfurRecoveryPercent >= 99.9, 'SCOT TGTU achieves > 99.9% overall sulfur recovery');
  assert.strictEqual(sruTrain.isUltraHighRecoveryAchieved, true);
  assert.ok(sruTrain.environmentalEmissions.stackSo2EmissionsKgH < 10.0);
});

test('AmineTreatingUnit: aMDEA Acid Gas Removal, Solvent Circulation & LNG Specs', () => {
  const amineResult = AmineTreatingUnit.sizeAmineUnit({
    sourGasFlowNm3H: 250000.0,
    inletPressureBarg: 65.0,
    inletTempC: 38.0,
    inletCo2MolPct: 4.8,
    inletH2sPpmv: 250.0,
    mdeaWeightPercent: 45.0,
    pzWeightPercent: 5.0,
    targetRichLoading: 0.45,
    leanLoading: 0.010
  });

  const { sweetGasProduct, solventHydraulics, absorberColumn, regeneratorAndReboiler } = amineResult;

  // Product specification verification
  assert.strictEqual(sweetGasProduct.co2ContentPpmv, 40.0);
  assert.strictEqual(sweetGasProduct.isLngFreezeOutProtected, true, 'CO2 < 50 ppmv ensures no dry ice in LNG cold box');
  assert.strictEqual(sweetGasProduct.isH2sPipelineAcceptable, true, 'H2S < 4 ppmv pipeline transmission limit');

  // Solvent hydraulics
  assert.ok(solventHydraulics.circulationRateM3H > 200.0);
  assert.ok(solventHydraulics.workingCapacityDeltaAlpha > 0.40);

  // Column and reboiler
  assert.ok(absorberColumn.columnDiameterMm >= 1800);
  assert.ok(regeneratorAndReboiler.reboilerDutyMW > 15.0);
  assert.ok(regeneratorAndReboiler.specificSteamConsumptionKgM3Amine > 80.0 && regeneratorAndReboiler.specificSteamConsumptionKgM3Amine < 160.0);

  // Corrosion limit check: rich loading > 0.50 throws error
  assert.throws(() => {
    AmineTreatingUnit.sizeAmineUnit({
      sourGasFlowNm3H: 100000,
      inletPressureBarg: 50,
      inletTempC: 35,
      inletCo2MolPct: 4,
      inletH2sPpmv: 100,
      targetRichLoading: 0.55
    });
  }, /targetRichLoading exceeds 0.50 mol/);
});

test('LngRegasVaporizers: ORV Seawater, SCV Fuel-Fired, and IFV Propane Loop', () => {
  const sendOutTonnesH = 380.0; // ~ 450 MMSCFD send-out

  // 1. Open Rack Vaporizer (ORV)
  const orv = LngRegasVaporizers.sizeOpenRackVaporizer({
    sendOutRateTonnesPerH: sendOutTonnesH,
    seawaterInletTempC: 22.0,
    maxSeawaterDeltaTC: 5.0
  });

  assert.strictEqual(orv.isSeawaterTempFeasible, true);
  assert.strictEqual(orv.environmentalVerdict.thermalDischargeCompliant, true);
  assert.strictEqual(orv.environmentalVerdict.co2EmissionsKgH, 0.0, 'ORV has zero direct combustion emissions');
  assert.ok(orv.seawaterOperating.flowRateM3H > 12000.0);

  // 2. Submerged Combustion Vaporizer (SCV)
  const scv = LngRegasVaporizers.sizeSubmergedCombustionVaporizer({
    sendOutRateTonnesPerH: sendOutTonnesH,
    scvThermalEfficiencyPercent: 98.0
  });

  assert.ok(scv.combustionPerformance.fuelConsumptionPercentageOfSendout >= 1.2 && scv.combustionPerformance.fuelConsumptionPercentageOfSendout <= 1.8, 'Fuel gas consumption is ~1.5% of LNG regas throughput');
  assert.ok(scv.combustionPerformance.hourlyCo2EmissionsTonnesH > 5.0);
  assert.ok(scv.bathOperation.bathNeutralizationNaohDemandKgH > 40.0);

  // 3. Intermediate Fluid Vaporizer (IFV)
  const ifv = LngRegasVaporizers.sizeIntermediateFluidVaporizer({
    sendOutRateTonnesPerH: sendOutTonnesH,
    seawaterInletTempC: 18.0
  });

  assert.strictEqual(ifv.intermediateFluid, 'High-Purity Commercial Propane (C3H8)');
  assert.ok(ifv.intermediateLoop.propaneCirculationKgS > 200.0);
});

test('AirCoolerApi661: Finned-Tube Bundle Geometry, Aerodynamics & API 661 Fan Sizing', () => {
  const ache = AirCoolerApi661.sizeAirCoolerBay({
    thermalDutyMW: 16.5,
    processInletTempC: 98.0,
    processOutletTempC: 45.0,
    ambientAirInletTempC: 32.0,
    targetAirFaceVelocityMS: 3.0,
    tubeLengthM: 10.0,
    numberOfTubeRows: 4,
    designOverallUBareW: 720.0,
    draftType: 'forced'
  });

  const { thermalPerformance, bundleGeometry, aerodynamicsAndFans } = ache;

  assert.ok(thermalPerformance.effectiveLmtdK > 15.0);
  assert.ok(thermalPerformance.crossFlowCorrectionFactorFT >= 0.90);
  assert.ok(bundleGeometry.totalTubesCount > 150);
  assert.ok(bundleGeometry.finnedSurfaceAreaM2 > bundleGeometry.bareSurfaceAreaM2 * 20.0, 'Fin multiplier ~ 21.4');
  assert.strictEqual(aerodynamicsAndFans.fansCountPerBay, 2);
  assert.strictEqual(aerodynamicsAndFans.isNoiseCompliant, true, 'Fan tip speed <= 60 m/s for API 661 noise');
  assert.ok(aerodynamicsAndFans.totalFanElectricPowerKW > 30.0);
});

test('FiredHeaterApi560: Lobo-Evans Radiant Section, Convection Recovery & API 530 Skin Temperature', () => {
  const heater = FiredHeaterApi560.sizeFiredHeater({
    processHeatDutyMW: 18.0,
    processInletTempC: 160.0,
    processOutletTempC: 285.0,
    radiantDutyFraction: 0.60,
    excessAirPercent: 15.0,
    maxAllowableFluxKWm2: 32.0,
    tubeMaterial: 'ASTM A312 TP316H'
  });

  const { thermalDuties, radiantFirebox, convectionSection, tubeSkinTemperatureApi530 } = heater;

  // Thermal balances
  assert.ok(thermalDuties.thermalEfficiencyPercent >= 88.0, 'API 560 heater efficiency >= 88%');
  assert.ok(thermalDuties.fuelGasConsumptionKgH > 1000.0);

  // Radiant Section
  assert.strictEqual(radiantFirebox.isRadiantFluxAcceptable, true, 'Average radiant flux is below 32 kW/m2 limit');
  assert.ok(radiantFirebox.bridgeWallTempC > 750.0 && radiantFirebox.bridgeWallTempC < 950.0);
  assert.ok(radiantFirebox.totalTubesCount > 30);

  // Tube skin temperature check per API 530
  assert.strictEqual(tubeSkinTemperatureApi530.isSkinTempAcceptable, true, 'Peak skin temperature <= 750 C allowable for 316H');
  assert.ok(tubeSkinTemperatureApi530.safetyMarginC > 50.0, 'Comfortable thermal safety margin below metallurgy creep limit');

  // Metallurgy test with Carbon Steel (A106 Gr B has 538 C allowable)
  const csHeater = FiredHeaterApi560.sizeFiredHeater({
    processHeatDutyMW: 10.0,
    processInletTempC: 100.0,
    processOutletTempC: 220.0,
    tubeMaterial: 'ASTM A106 Gr B'
  });
  assert.strictEqual(csHeater.tubeSkinTemperatureApi530.allowableMetalDesignTempC, 538.0);
  assert.strictEqual(csHeater.tubeSkinTemperatureApi530.isSkinTempAcceptable, true);
});

test('PlantEngineeringMasterApi: Utilities & Process Disciplines Integration', () => {
  const master = PlantEngineeringMasterApi;

  // Utilities
  assert.ok(master.utilities, 'Utilities discipline exposed on Master API');
  assert.strictEqual(typeof master.utilities.CoolingWaterSystems, 'function');
  assert.strictEqual(typeof master.utilities.SteamCondensateBalance, 'function');
  assert.strictEqual(typeof master.utilities.InstrumentAirNitrogenSystems, 'function');
  assert.strictEqual(typeof master.utilities.FuelGasConditioningSystem, 'function');
  assert.strictEqual(typeof master.utilities.WaterTreatmentSystems, 'function');

  // Process Units
  assert.ok(master.process, 'Process discipline exposed on Master API');
  assert.strictEqual(typeof master.process.ClausSulfurRecoveryUnit, 'function');
  assert.strictEqual(typeof master.process.AmineTreatingUnit, 'function');
  assert.strictEqual(typeof master.process.LngRegasVaporizers, 'function');
  assert.strictEqual(typeof master.process.AirCoolerApi661, 'function');
  assert.strictEqual(typeof master.process.FiredHeaterApi560, 'function');
});
