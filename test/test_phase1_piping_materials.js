'use strict';

// claims:evidence:ASME-B31.3-ASME-Section-II-Part-D-ISO-14692-API-570-API-RP-14E

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PlantEngineeringMasterApi,
  ASME_MATERIAL_CATALOG,
  getMaterialPropertiesAtTemp,
  resolveMaterial,
  NonmetallicPipingB31_3,
  NONMETALLIC_MATERIALS,
  PipingMaterialClassSpec,
  PIPING_MATERIAL_CLASSES,
  CorrosionRemainingLifeApi570,
  API_570_CLASS_INTERVALS,
  InsulationHeatTracing,
  INSULATION_MATERIALS,
  TwoPhaseFlowEngine,
  MaterialTakeoffBom
} = require('../src/core/plant/plant_engineering_master_api');

test('ASME Section II Part D Expanded Materials Catalog (~45+ Materials)', () => {
  const keys = Object.keys(ASME_MATERIAL_CATALOG);
  assert.ok(keys.length >= 45, `Catalog must have at least 45 materials, found ${keys.length}`);

  // 1. Carbon Steel and LTCS Forgings & Fittings
  const a105 = getMaterialPropertiesAtTemp('A105', 38);
  assert.equal(a105.allowableStressMPa, 138.0);
  assert.equal(a105.yieldStrengthMPa, 250.0);

  const a234Wpb = getMaterialPropertiesAtTemp('A234-WPB', 100);
  assert.ok(a234Wpb.allowableStressMPa > 130.0);

  const a420Wpl6 = getMaterialPropertiesAtTemp('A420-WPL6', -40);
  assert.equal(a420Wpl6.allowableStressMPa, 138.0);

  const lf2 = getMaterialPropertiesAtTemp('A350-LF2', -46);
  assert.equal(lf2.allowableStressMPa, 138.0);

  const lf3 = getMaterialPropertiesAtTemp('A350-LF3', -100);
  assert.equal(lf3.allowableStressMPa, 138.0);

  // 2. Pressure Vessel Plates
  const a516Gr70 = getMaterialPropertiesAtTemp('A516-GR70', 200);
  assert.equal(a516Gr70.allowableStressMPa, 138.0);

  const a537Cl1 = getMaterialPropertiesAtTemp('A537-CL1', 100);
  assert.equal(a537Cl1.allowableStressMPa, 162.0);

  // 3. High-Nickel and Super Alloys
  const monel400 = getMaterialPropertiesAtTemp('B165-N04400', 38);
  assert.equal(monel400.allowableStressMPa, 120.0);
  assert.equal(monel400.yieldStrengthMPa, 195.0);

  const incoloy825 = getMaterialPropertiesAtTemp('B423-N08825', 100);
  assert.equal(incoloy825.allowableStressMPa, 147.0);

  const incoloy800h = getMaterialPropertiesAtTemp('B407-N08810', 500);
  assert.ok(incoloy800h.allowableStressMPa >= 88.0);

  const alloy20 = getMaterialPropertiesAtTemp('B464-N08020', 38);
  assert.equal(alloy20.allowableStressMPa, 138.0);

  const sixMo = getMaterialPropertiesAtTemp('A312-UNS-S31254', 100);
  assert.equal(sixMo.allowableStressMPa, 148.0);

  // 4. Copper-Nickel Alloys (Seawater / Cooling water)
  const cuNi9010 = getMaterialPropertiesAtTemp('B466-UNS-C70600', 38);
  assert.equal(cuNi9010.allowableStressMPa, 69.0);

  const cuNi7030 = getMaterialPropertiesAtTemp('B466-UNS-C71500', 38);
  assert.equal(cuNi7030.allowableStressMPa, 83.0);

  // 5. Titanium Alloys
  const tiGr5 = getMaterialPropertiesAtTemp('B861-TI-GR5', 38);
  assert.equal(tiGr5.allowableStressMPa, 224.0);
  assert.equal(tiGr5.yieldStrengthMPa, 828.0);

  const tiGr7 = getMaterialPropertiesAtTemp('B861-TI-GR7', 38);
  assert.equal(tiGr7.allowableStressMPa, 95.0);

  const tiGr12 = getMaterialPropertiesAtTemp('B861-TI-GR12', 38);
  assert.equal(tiGr12.allowableStressMPa, 131.0);

  // 6. Valve Castings, Forgings & Bolting Materials
  const wcb = getMaterialPropertiesAtTemp('A216-WCB', 100);
  assert.ok(wcb.allowableStressMPa >= 120.0);

  const lcb = getMaterialPropertiesAtTemp('A352-LCB', -46);
  assert.equal(lcb.allowableStressMPa, 129.0);

  const cf8m = getMaterialPropertiesAtTemp('A351-CF8M', 38);
  assert.equal(cf8m.allowableStressMPa, 138.0);

  const b564Monel = getMaterialPropertiesAtTemp('B564-N04400', 38);
  assert.equal(b564Monel.allowableStressMPa, 120.0);

  const b564Incoloy = getMaterialPropertiesAtTemp('B564-N08825', 100);
  assert.equal(b564Incoloy.allowableStressMPa, 147.0);

  const b7Bolt = getMaterialPropertiesAtTemp('A193-B7', 100);
  assert.equal(b7Bolt.allowableStressMPa, 172.0);

  const l7Bolt = getMaterialPropertiesAtTemp('A320-L7', -100);
  assert.equal(l7Bolt.allowableStressMPa, 172.0);

  const b8mBolt = getMaterialPropertiesAtTemp('A193-B8M', 38);
  assert.equal(b8mBolt.allowableStressMPa, 131.0);

  // 7. Name / alias resolution
  const resolvedAlias1 = resolveMaterial('Monel 400');
  assert.ok(resolvedAlias1 && resolvedAlias1.id === 'B165-N04400');

  const resolvedAlias2 = resolveMaterial('A105N');
  assert.ok(resolvedAlias2 && resolvedAlias2.id === 'A105');

  const resolvedAlias3 = resolveMaterial('6Mo');
  assert.ok(resolvedAlias3 && resolvedAlias3.id === 'A312-UNS-S31254');

  const resolvedAlias4 = resolveMaterial('SS316L');
  assert.ok(resolvedAlias4 && resolvedAlias4.id === 'A312-TP316L');

  const resolvedAlias5 = resolveMaterial('CS');
  assert.ok(resolvedAlias5 && resolvedAlias5.id === 'A106-B');

  const resolvedAlias6 = resolveMaterial('LTCS');
  assert.ok(resolvedAlias6 && resolvedAlias6.id === 'A333-6');

  const resolvedAlias7 = resolveMaterial('DUPLEX 2205');
  assert.ok(resolvedAlias7 && resolvedAlias7.id === 'A790-UNS-S31803');

  const resolvedAlias8 = resolveMaterial('A216 WCB');
  assert.ok(resolvedAlias8 && resolvedAlias8.id === 'A216-WCB');

  // 8. Temperature code limits enforcement
  assert.throws(() => {
    getMaterialPropertiesAtTemp('A516-GR70', 500); // Exceeds 427 °C limit
  }, /exceeds ASME Section II Part D maximum code limit/);

  assert.throws(() => {
    getMaterialPropertiesAtTemp('A350-LF2', -60); // Below -46 °C MDMT
  }, /below MDMT limit/);
});

test('Nonmetallic Piping ASME B31.3 Chapter VII (GRE/FRP, HDPE, PVC/CPVC)', () => {
  // 1. GRE / FRP per ISO 14692
  const greWater = NonmetallicPipingB31_3.calculateGreFrp({
    designPressureBar: 16.0,
    designTempC: 45.0,
    outsideDiameterMm: 219.1,
    linerThicknessMm: 1.5,
    serviceFluid: 'seawater',
    isCyclic: false,
    componentType: 'straight_pipe'
  });
  assert.equal(greWater.standard, 'ISO 14692 / ASME B31.3 Chapter VII');
  assert.ok(greWater.allowableHoopStressMPa > 30.0);
  assert.ok(greWater.tReinforcedMm > 0.0);
  assert.ok(greWater.totalWallThicknessMm > greWater.tReinforcedMm);
  assert.ok(greWater.mawpBar >= 16.0);
  assert.equal(greWater.isAcceptable, true);

  // 2. HDPE per ISO 9080 & ISO 4427
  const hdpe = NonmetallicPipingB31_3.calculateHdpe({
    peGrade: 'PE100',
    designPressureBar: 10.0,
    designTempC: 30.0,
    outsideDiameterMm: 315.0,
    sdr: 11.0,
    serviceCategory: 'water'
  });
  assert.equal(hdpe.peGrade, 'HDPE-PE100');
  assert.equal(hdpe.sdr, 11.0);
  assert.ok(hdpe.nominalWallMm > 25.0);
  assert.ok(hdpe.maopBar >= 10.0);
  assert.equal(hdpe.isAcceptable, true);

  // SDR selector helper
  const sdrSelection = NonmetallicPipingB31_3.selectHdpeSdr(250.0, 12.0, 25.0, 'water');
  assert.ok([7.4, 9.0, 11.0].includes(sdrSelection.selectedSdr));
  assert.ok(sdrSelection.maopBar >= 12.0);

  // 3. PVC & CPVC per ASTM D1785 / F441
  const pvc = NonmetallicPipingB31_3.calculatePvcCpvc({
    materialType: 'PVC',
    outsideDiameterMm: 114.3, // 4" pipe
    wallThicknessMm: 6.02, // Sch 40
    designPressureBar: 8.0,
    designTempC: 25.0
  });
  assert.ok(pvc.mawpBar > 10.0);
  assert.equal(pvc.isAcceptable, true);

  // Elevated temperature derating for CPVC
  const cpvcHot = NonmetallicPipingB31_3.calculatePvcCpvc({
    materialType: 'CPVC',
    outsideDiameterMm: 88.9,
    wallThicknessMm: 7.62,
    designPressureBar: 5.0,
    designTempC: 75.0
  });
  assert.ok(cpvcHot.tempDeratingFactor < 0.45);
  assert.equal(cpvcHot.isAcceptable, true);

  // 4. Maximum support span calculation
  const spanGre = NonmetallicPipingB31_3.evaluateNonmetallicSupportSpan({
    materialKey: 'GRE-EPOXY',
    outsideDiameterMm: 168.3,
    wallThicknessMm: 6.5,
    fluidDensityKgM3: 1025.0,
    maxDeflectionMm: 12.5
  });
  assert.ok(spanGre.maxSpanM > 4.0 && spanGre.maxSpanM < 9.0);

  // 5. Parameter validation and error cases
  assert.throws(() => {
    NonmetallicPipingB31_3.calculateHdpe({
      peGrade: 'PE100',
      designPressureBar: 10.0,
      designTempC: 30.0,
      outsideDiameterMm: 315.0,
      sdr: 0.5 // Invalid SDR <= 1.0
    });
  }, /SDR must be greater than 1/);

  assert.throws(() => {
    NonmetallicPipingB31_3.calculatePvcCpvc({
      materialType: 'PVC',
      outsideDiameterMm: 114.3,
      wallThicknessMm: 70.0, // wall >= OD / 2
      designPressureBar: 8.0,
      designTempC: 25.0
    });
  }, /Wall thickness must be less than half of outside diameter/);
});

test('Piping Material Class Specification Generator & NACE MR0175 Compliance', () => {
  // 1. Piping Class lookup
  const a1a = PipingMaterialClassSpec.getClassSpec('A1A');
  assert.equal(a1a.classCode, 'A1A');
  assert.equal(a1a.ratingClass, 150);
  assert.equal(a1a.corrosionAllowanceMm, 3.0);
  assert.equal(a1a.pipeMaterial, 'A106-B');

  const b2l = PipingMaterialClassSpec.getClassSpec('B2L');
  assert.equal(b2l.classCode, 'B2L');
  assert.equal(b2l.pipeMaterial, 'A333-6');
  assert.equal(b2l.flangeMaterial, 'A350-LF2');
  assert.equal(b2l.minTempC, -46.0);

  const c9s = PipingMaterialClassSpec.getClassSpec('C9S');
  assert.equal(c9s.classCode, 'C9S');
  assert.equal(c9s.pipeMaterial, 'A312-TP316L');
  assert.equal(c9s.minTempC, -196.0);
  assert.equal(c9s.corrosionAllowanceMm, 0.0);

  const d6n = PipingMaterialClassSpec.getClassSpec('D6N');
  assert.equal(d6n.classCode, 'D6N');
  assert.equal(d6n.isSourService, true);

  // 2. Branch connection tables
  // Equal size -> Equal Tee
  const brEqual = PipingMaterialClassSpec.getBranchConnection(12, 12, 'A1A');
  assert.equal(brEqual.fittingCode, 'TE');

  // Reducing size -> Reducing Tee
  const brReduce = PipingMaterialClassSpec.getBranchConnection(12, 8, 'A1A');
  assert.equal(brReduce.fittingCode, 'TR');

  // Small bore on large run -> Weldolet
  const brOlet = PipingMaterialClassSpec.getBranchConnection(16, 2, 'A1A');
  assert.equal(brOlet.fittingCode, 'WOL');

  // 3. NACE MR0175 Sour Service Evaluation
  // Case A: Non-sour process
  const sweetEval = PipingMaterialClassSpec.evaluateNaceMr0175({
    classCode: 'A1A',
    h2sPartialPressureKPa: 0.1,
    totalPressureBarg: 20.0,
    operatingTempC: 45.0,
    ph: 5.5
  });
  assert.equal(sweetEval.isSourProcess, false);
  assert.equal(sweetEval.isAcceptable, true);

  // Case B: Sour process on non-sour piping class A1A
  const sourFail = PipingMaterialClassSpec.evaluateNaceMr0175({
    classCode: 'A1A',
    h2sPartialPressureKPa: 5.0,
    totalPressureBarg: 30.0,
    operatingTempC: 50.0,
    ph: 4.8
  });
  assert.equal(sourFail.isSourProcess, true);
  assert.equal(sourFail.isAcceptable, false); // Fails because A1A has non-sour B7 bolting and lacks sour designation
  assert.ok(sourFail.warnings.length > 0);

  // Case C: Sour process on designated sour class D6N (Duplex 2205)
  const sourPass = PipingMaterialClassSpec.evaluateNaceMr0175({
    classCode: 'D6N',
    h2sPartialPressureKPa: 8.0,
    totalPressureBarg: 50.0,
    operatingTempC: 80.0,
    ph: 4.5
  });
  assert.equal(sourPass.isSourProcess, true);
  assert.equal(sourPass.isAcceptable, true);
  assert.equal(sourPass.maxHardnessHrc, 28);

  // 4. ASME B16.5 Flange Pressure-Temperature Ratings
  const flangeRatingA1a = PipingMaterialClassSpec.getFlangePressureRating('A1A', 200);
  assert.equal(flangeRatingA1a.ratingClass, 150);
  assert.equal(flangeRatingA1a.mawpBarg, 13.8);

  const flangeRatingB2l = PipingMaterialClassSpec.getFlangePressureRating('B2L', 38);
  assert.equal(flangeRatingB2l.ratingClass, 300);
  assert.equal(flangeRatingB2l.mawpBarg, 51.1);

  // String NPS branch connection handling (proves no lexicographical string compare error '8' > '12')
  const brStringNps = PipingMaterialClassSpec.getBranchConnection('12', '8', 'A1A');
  assert.equal(brStringNps.fittingCode, 'TR');

  // Monel Class 150 (Group 3.4) and HDPE Class 150 ratings
  const flangeMonel = PipingMaterialClassSpec.getFlangePressureRating('N4M', 38);
  assert.equal(flangeMonel.ratingClass, 150);
  assert.equal(flangeMonel.mawpBarg, 15.9);

  const flangeHdpe = PipingMaterialClassSpec.getFlangePressureRating('P1H', 20);
  assert.equal(flangeHdpe.ratingClass, 150);
  assert.equal(flangeHdpe.mawpBarg, 16.0);
});

test('API 570 / API 579 Corrosion Rates, Remaining Life & de Waard-Milliams Model', () => {
  // 1. Corrosion rate calculations
  const cr = CorrosionRemainingLifeApi570.calculateCorrosionRate({
    tInitialMm: 12.7,
    tPreviousMm: 10.5,
    tActualMm: 9.8,
    yearsSinceInitial: 10.0,
    yearsSincePrevious: 2.0
  });
  assert.equal(cr.crLongTermMmYr, 0.29);
  assert.equal(cr.crShortTermMmYr, 0.35);
  assert.equal(cr.crGoverningMmYr, 0.35);

  // 2. Minimum thickness calculation
  const tmin = CorrosionRemainingLifeApi570.calculateMinimumThickness({
    designPressureBarg: 40.0,
    outsideDiameterMm: 219.1, // 8" pipe
    allowableStressMPa: 138.0,
    jointEfficiency: 1.0,
    nps: '8'
  });
  assert.ok(tmin.tPressureMm > 3.0);
  assert.equal(tmin.tStructuralMm, 3.2);
  assert.ok(tmin.tMinRequiredMm >= 3.2);

  // 3. Remaining life and half-life inspection interval
  const rl = CorrosionRemainingLifeApi570.calculateRemainingLife({
    tActualMm: 7.5,
    tMinRequiredMm: 4.0,
    corrosionRateMmYr: 0.35,
    pipingClass: 1 // Cryogenic / flammable gas
  });
  assert.equal(rl.remainingLifeYears, 10.0);
  assert.equal(rl.halfLifeYears, 5.0);
  assert.equal(rl.nextThicknessInspectionYears, 5.0);
  assert.equal(rl.isBelowTmin, false);

  // 4. API 579 Level 1 Local Thin Area (LTA)
  const ffs = CorrosionRemainingLifeApi570.evaluateLocalThinAreaApi579({
    outsideDiameterMm: 323.8, // 12" pipe
    nominalWallMm: 10.31,
    tMinRequiredMm: 6.0,
    tMinMeasuredMm: 5.5,
    lengthAxialMm: 50.0,
    designPressureBarg: 45.0,
    rsfAllowable: 0.90
  });
  assert.ok(ffs.foliasFactorM > 1.0);
  assert.ok(ffs.rsfCalculated > 0.85);
  assert.equal(typeof ffs.isAcceptableAtDesignPressure, 'boolean');

  // 5. de Waard-Milliams CO2 sweet corrosion model
  const co2LowT = CorrosionRemainingLifeApi570.calculateDeWaardMilliams({
    totalPressureBarg: 60.0,
    co2MolePercent: 2.5,
    operatingTempC: 40.0,
    flowVelocityMS: 2.5,
    inhibitorEfficiency: 0.90
  });
  assert.ok(co2LowT.pCo2Bar > 1.5);
  assert.ok(co2LowT.bareCorrosionRateMmYr > 1.0);
  assert.ok(co2LowT.estimatedCorrosionRateMmYr < 0.5); // Inhibitor cuts by 90%

  // High temperature scaling test (protective siderite scale formation)
  const co2At85 = CorrosionRemainingLifeApi570.calculateDeWaardMilliams({
    totalPressureBarg: 60.0,
    co2MolePercent: 2.5,
    operatingTempC: 85.0,
    flowVelocityMS: 2.0
  });
  assert.ok(co2At85.protectiveScaleFactor < 0.80); // Scale protection factor actively derates rate (~0.778)

  const co2At95 = CorrosionRemainingLifeApi570.calculateDeWaardMilliams({
    totalPressureBarg: 60.0,
    co2MolePercent: 2.5,
    operatingTempC: 95.0,
    flowVelocityMS: 2.0
  });
  assert.ok(co2At95.protectiveScaleFactor < 0.55); // More substantial derating at higher temperature

  // 6. Immediate repair required when thickness is below t_min
  const rlViolated = CorrosionRemainingLifeApi570.calculateRemainingLife({
    tActualMm: 3.2,
    tMinRequiredMm: 4.5,
    corrosionRateMmYr: 0.35,
    pipingClass: 1
  });
  assert.equal(rlViolated.isBelowTmin, true);
  assert.equal(rlViolated.nextThicknessInspectionYears, 0.0);
  assert.equal(rlViolated.nextVisualInspectionYears, 0.0);
  assert.ok(rlViolated.actionRequired.includes('REPAIR OR RETIRE'));

  // 7. Through-wall flaw in API 579 LTA (tMinMeasured = 0)
  const ffsThroughWall = CorrosionRemainingLifeApi570.evaluateLocalThinAreaApi579({
    outsideDiameterMm: 323.8,
    nominalWallMm: 10.31,
    tMinRequiredMm: 6.0,
    tMinMeasuredMm: 0.0,
    lengthAxialMm: 50.0
  });
  assert.equal(ffsThroughWall.rsfCalculated, 0.0);
  assert.equal(ffsThroughWall.isAcceptableAtDesignPressure, false);
});

test('ASTM C680 Heat Loss & Cryogenic LNG Condensation Control', () => {
  // 1. Hot steam pipe heat loss
  const hotPipe = InsulationHeatTracing.calculateHeatTransferAstmC680({
    pipeOutsideDiameterMm: 219.1, // 8"
    operatingTempC: 250.0,
    ambientTempC: 25.0,
    insulationThicknessMm: 75.0,
    insulationType: 'MINERAL_WOOL',
    windSpeedMS: 3.0
  });
  assert.ok(hotPipe.heatTransferPerMeterWM > 50.0 && hotPipe.heatTransferPerMeterWM < 200.0);
  assert.ok(hotPipe.surfaceTempC < 60.0, 'Personnel protection threshold satisfied');

  // 2. Psychrometric dew point
  const dewPoint = InsulationHeatTracing.calculateDewPoint(32.0, 85.0);
  assert.ok(dewPoint > 28.0 && dewPoint < 30.0);

  // 3. Cryogenic LNG condensation control (-162 °C)
  const lngIns = InsulationHeatTracing.sizeCryogenicCondensationControl({
    pipeOutsideDiameterMm: 406.4, // 16" LNG line
    operatingTempC: -162.0,
    ambientTempC: 32.0,
    relativeHumidityPercent: 85.0,
    windSpeedMS: 1.0,
    insulationType: 'PIR',
    marginC: 1.5
  });
  assert.ok(lngIns.requiredThicknessMm >= 100.0);
  assert.ok(lngIns.numberOfLayers >= 2, 'Cryogenic requires multi-layer staggered joints');
  assert.ok(lngIns.achievedSurfaceTempC >= lngIns.targetSurfaceTempC);
  assert.equal(lngIns.isCondensationPrevented, true);
  assert.ok(lngIns.bogRateKgHrM > 0.0);

  // 4. Electric heat tracing sizing per IEEE 515
  const eht = InsulationHeatTracing.sizeElectricHeatTracing({
    pipeOutsideDiameterMm: 114.3,
    maintainTempC: 15.0,
    minAmbientTempC: -20.0,
    insulationThicknessMm: 50.0,
    insulationType: 'MINERAL_WOOL',
    pipeLengthM: 150.0,
    valveCount: 6,
    flangePairCount: 12
  });
  assert.ok(eht.requiredPowerPerMeterWM > 5.0);
  assert.ok(eht.totalCableLengthM > 150.0); // Includes heat sinks
  assert.ok(eht.totalPowerKw > 0.0);

  // 5. Steam heat tracing sizing
  const sht = InsulationHeatTracing.sizeSteamHeatTracing({
    pipeOutsideDiameterMm: 219.1, // 8" process line
    maintainTempC: 60.0,
    minAmbientTempC: -10.0,
    insulationThicknessMm: 50.0,
    insulationType: 'CALCIUM_SILICATE',
    steamPressureBarg: 3.5, // LP steam
    pipeLengthM: 200.0,
    tracerDiameter: '1/2',
    tracerAttachment: 'HEAT_TRANSFER_COMPOUND'
  });
  assert.ok(sht.steamSatTempC > 140.0);
  assert.ok(sht.latentHeatKjKg > 2000.0);
  assert.ok(sht.tracersRequired >= 1);
  assert.ok(sht.steamFlowKgHr > 0.0);
  assert.ok(sht.numberOfCircuits >= 3);
  assert.equal(sht.condensateTrapCount, sht.numberOfCircuits);

  // 6. Extreme humidity cryogenic condensation control (ensures thickness ceiling doesn't reset to 25 mm)
  const extremeCryo = InsulationHeatTracing.sizeCryogenicCondensationControl({
    pipeOutsideDiameterMm: 406.4,
    operatingTempC: -162.0,
    ambientTempC: 38.0,
    relativeHumidityPercent: 95.0, // Extremely humid tropical LNG terminal
    windSpeedMS: 0.5,
    insulationType: 'CELLULAR_GLASS'
  });
  assert.ok(extremeCryo.selectedThicknessMm >= 300.0);
  assert.ok(extremeCryo.numberOfLayers >= 3);
});

test('Two-Phase Flow (Beggs-Brill, Lockhart-Martinelli & API RP 14E)', () => {
  // 1. Beggs and Brill horizontal multiphase flow
  const bbHoriz = TwoPhaseFlowEngine.calculateBeggsBrill({
    pipeInsideDiameterMm: 200.0,
    pipeLengthM: 1000.0,
    inclinationAngleDeg: 0.0,
    gasMassFlowKgS: 12.0,
    liquidMassFlowKgS: 35.0,
    gasDensityKgM3: 45.0,
    liquidDensityKgM3: 820.0,
    gasViscosityPaS: 1.4e-5,
    liquidViscosityPaS: 1.2e-3
  });
  assert.equal(bbHoriz.method, 'Beggs and Brill (1973)');
  assert.ok(['Segregated', 'Intermittent', 'Distributed', 'Transition'].includes(bbHoriz.flowRegime));
  assert.ok(bbHoriz.liquidHoldup > 0.0 && bbHoriz.liquidHoldup <= 1.0);
  assert.ok(bbHoriz.totalPressureDropBar > 0.0);

  // Incline comparison: Uphill (+15 deg) has higher pressure drop due to hydrostatic head
  const bbUphill = TwoPhaseFlowEngine.calculateBeggsBrill({
    pipeInsideDiameterMm: 200.0,
    pipeLengthM: 1000.0,
    inclinationAngleDeg: 15.0,
    gasMassFlowKgS: 12.0,
    liquidMassFlowKgS: 35.0,
    gasDensityKgM3: 45.0,
    liquidDensityKgM3: 820.0,
    gasViscosityPaS: 1.4e-5,
    liquidViscosityPaS: 1.2e-3
  });
  assert.ok(bbUphill.dpElevationBar > 0.0);
  assert.ok(bbUphill.totalPressureDropBar > bbHoriz.totalPressureDropBar);

  // 2. Lockhart and Martinelli
  const lm = TwoPhaseFlowEngine.calculateLockhartMartinelli({
    pipeInsideDiameterMm: 200.0,
    pipeLengthM: 1000.0,
    gasMassFlowKgS: 12.0,
    liquidMassFlowKgS: 35.0,
    gasDensityKgM3: 45.0,
    liquidDensityKgM3: 820.0,
    gasViscosityPaS: 1.4e-5,
    liquidViscosityPaS: 1.2e-3
  });
  assert.equal(lm.method, 'Lockhart and Martinelli (1949)');
  assert.ok(lm.xMartinelli > 0.0);
  assert.ok(lm.multiplierPhiL2 > 1.0);
  assert.ok(lm.totalPressureDropBar > 0.0);

  // 3. API RP 14E Erosional Velocity
  const aeroCs = TwoPhaseFlowEngine.evaluateErosionalVelocityApi14E({
    mixtureVelocityMS: 14.5,
    mixtureDensityKgM3: 80.0,
    pipingMaterial: 'CARBON_STEEL',
    hasSolids: false
  });
  assert.equal(aeroCs.standard, 'API RP 14E Section 2.5');
  assert.ok(aeroCs.erosionalVelocityLimitMS > 10.0);
  assert.equal(typeof aeroCs.isErosionSafe, 'boolean');

  // Duplex allows higher erosional velocity limit
  const aeroDuplex = TwoPhaseFlowEngine.evaluateErosionalVelocityApi14E({
    mixtureVelocityMS: 14.5,
    mixtureDensityKgM3: 80.0,
    pipingMaterial: 'DUPLEX',
    hasSolids: false
  });
  assert.ok(aeroDuplex.erosionalVelocityLimitMS > aeroCs.erosionalVelocityLimitMS);

  // Monel and Titanium CRA evaluation
  const aeroCra = TwoPhaseFlowEngine.evaluateErosionalVelocityApi14E({
    mixtureVelocityMS: 14.5,
    mixtureDensityKgM3: 80.0,
    pipingMaterial: 'MONEL',
    hasSolids: false
  });
  assert.ok(aeroCra.cEmpirical >= 150.0);

  // Single-phase edge cases for Lockhart-Martinelli (proves no NaN from 64/0 division)
  const lmDryGas = TwoPhaseFlowEngine.calculateLockhartMartinelli({
    pipeInsideDiameterMm: 200.0,
    pipeLengthM: 1000.0,
    gasMassFlowKgS: 15.0,
    liquidMassFlowKgS: 0.0, // Pure dry gas
    gasDensityKgM3: 45.0,
    liquidDensityKgM3: 820.0,
    gasViscosityPaS: 1.4e-5,
    liquidViscosityPaS: 1.2e-3
  });
  assert.ok(!Number.isNaN(lmDryGas.totalPressureDropBar));
  assert.ok(lmDryGas.totalPressureDropBar > 0.0);
  assert.equal(lmDryGas.liquidHoldup, 0.0);

  const lmPureLiquid = TwoPhaseFlowEngine.calculateLockhartMartinelli({
    pipeInsideDiameterMm: 200.0,
    pipeLengthM: 1000.0,
    gasMassFlowKgS: 0.0, // Pure liquid
    liquidMassFlowKgS: 50.0,
    gasDensityKgM3: 45.0,
    liquidDensityKgM3: 820.0,
    gasViscosityPaS: 1.4e-5,
    liquidViscosityPaS: 1.2e-3
  });
  assert.ok(!Number.isNaN(lmPureLiquid.totalPressureDropBar));
  assert.ok(lmPureLiquid.totalPressureDropBar > 0.0);
  assert.equal(lmPureLiquid.liquidHoldup, 1.0);

  // 4. Slug catcher sizing
  const slug = TwoPhaseFlowEngine.sizeSlugCatcher({
    pipeInsideDiameterMm: 500.0,
    liquidHoldup: 0.35,
    slugLengthInDiameters: 30.0,
    numberOfFingers: 4,
    fingerInsideDiameterMm: 914.4
  });
  assert.ok(slug.singleSlugVolumeM3 > 0.5);
  assert.ok(slug.requiredFingerLengthM >= 5.0);
});

test('Material Takeoff (MTO) & BOM Aggregation Engine', () => {
  const components = [
    // 24" Main header pipe
    { type: 'PIPE', nps: '24', lengthM: 350.0, pipingClass: 'A1A', material: 'A106-B', schedule: 'Sch 40' },
    // 12" Branch pipe
    { type: 'PIPE', nps: '12', lengthM: 120.0, pipingClass: 'A1A', material: 'A106-B', schedule: 'Sch STD' },
    // 24" 90 deg LR Elbows
    { type: 'ELBOW_90_LR', nps: '24', count: 6, pipingClass: 'A1A', material: 'A234-WPB', schedule: 'Sch 40' },
    // 24" x 12" Reducing Tee
    { type: 'TEE_REDUCING', nps: '24', count: 2, pipingClass: 'A1A', material: 'A234-WPB', schedule: 'Sch 40' },
    // 24" Weld Neck Flanges
    { type: 'FLANGE', flangeType: 'Weld Neck (WN)', nps: '24', count: 4, rating: 150, facing: 'RF', material: 'A105' },
    // 12" Weld Neck Flanges
    { type: 'FLANGE', flangeType: 'Weld Neck (WN)', nps: '12', count: 4, rating: 150, facing: 'RF', material: 'A105' },
    // 24" Ball Valve
    { type: 'VALVE', valveType: 'Ball Valve', tag: 'XV-1001', nps: '24', rating: 150, material: 'A216-WCB', trim: 'Trim 8', count: 1 },
    // 12" Control Valve
    { type: 'VALVE', valveType: 'Control Valve', tag: 'FCV-1002', nps: '12', rating: 150, material: 'A216-WCB', trim: 'Stellite', count: 1 }
  ];

  const mto = MaterialTakeoffBom.generateMto(components, { shopWeldRatio: 0.70 });

  assert.ok(mto.summary.totalPipeLengthM === 470.0);
  assert.ok(mto.summary.totalSteelWeightKg > 50000.0);
  assert.ok(mto.summary.totalSteelTonnageMT > 50.0);
  assert.ok(mto.summary.totalDiaInch > 300.0);
  assert.ok(mto.summary.shopDiaInch > 200.0);
  assert.ok(mto.summary.fieldDiaInch > 50.0);

  // Fasteners & Gaskets automatically generated for flanges
  assert.ok(mto.fasteners.length > 0);
  assert.ok(mto.summary.boltSetsTotal >= (4 * 20 + 4 * 12)); // 24" has 20 bolts, 12" has 12 bolts per flange
  assert.ok(mto.gaskets.length > 0);
  assert.equal(mto.summary.gasketCount, 8); // 4 + 4 flanges

  // Export to CSV
  const csv = MaterialTakeoffBom.exportToCsv(mto);
  assert.ok(csv.includes('PIPE,Seamless/Welded Pipe,24",Sch 40,A106-B,350,M'));
  assert.ok(csv.includes('FASTENER,Stud Bolt with 2 Heavy Hex Nuts'));
  assert.ok(csv.includes('GASKET,Spiral Wound'));

  // Class 900, 1500 bolting catalog test & Slip-On / Socket-Weld flange weld counts
  const highPressureComponents = [
    { type: 'FLANGE', flangeType: 'Slip-On (SO)', nps: '8', count: 2, rating: 900, facing: 'RTJ', material: 'A182-F316L' },
    { type: 'FLANGE', flangeType: 'Socket-Weld (SW)', nps: '2', count: 4, rating: 600, facing: 'RF', material: 'A105' }
  ];
  const hpMto = MaterialTakeoffBom.generateMto(highPressureComponents);
  assert.ok(hpMto.fasteners.length > 0);
  assert.equal(hpMto.fasteners[0].ratingClass, '900#');
  assert.equal(hpMto.fasteners[0].diameterInch, '1-3/8');
  assert.equal(hpMto.summary.totalWeldCount, 8); // 2 SO * 2 + 4 SW * 1 = 8 welds
  assert.equal(hpMto.summary.socketWeldDiaInch, 44.0); // 2*8*2 + 4*2*1.5 = 44 dia-inch
});
