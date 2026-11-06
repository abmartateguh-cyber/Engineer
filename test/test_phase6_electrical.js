'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ElectricalLoadList,
  CableSizingIec60364,
  ShortCircuitIec60909,
  TransformerGeneratorSizing,
  SingleLineDiagramGenerator
} = require('../src/core/plant/electrical');

const { PlantEngineeringMasterApi } = require('../src/core/plant/plant_engineering_master_api');

test('ElectricalLoadList: Consumer Registration, Duty Cycles & Operating Cases', () => {
  const loadList = new ElectricalLoadList('World-Scale LNG Train 1');

  // Add HV & MV Process Compressor Motors
  const k201 = loadList.addLoad({
    tag: 'K-201',
    description: 'Main Propane Refrigeration Compressor Motor',
    bus: 'MV-6.6KV',
    shaftPowerKW: 12000.0,
    efficiency: 0.965,
    powerFactor: 0.90,
    duty: 'C'
  });

  assert.strictEqual(k201.tag, 'K-201');
  assert.ok(k201.activePowerKW > 12000.0, 'Consumed kW must account for motor efficiency');
  assert.ok(k201.apparentPowerKVA > k201.activePowerKW, 'kVA must exceed kW at 0.90 pf');
  assert.ok(k201.fullLoadAmps > 1000.0, 'Full load current on 6.6 kV bus');

  // Add 400V Continuous, Intermittent, and Standby Utility Pumps
  const p101a = loadList.addLoad({
    tag: 'P-101A',
    description: 'Amine Booster Pump A (Running)',
    bus: 'LV-400V',
    shaftPowerKW: 110.0,
    efficiency: 0.94,
    powerFactor: 0.86,
    duty: 'C'
  });

  const p101b = loadList.addLoad({
    tag: 'P-101B',
    description: 'Amine Booster Pump B (Standby)',
    bus: 'LV-400V',
    shaftPowerKW: 110.0,
    efficiency: 0.94,
    powerFactor: 0.86,
    duty: 'S'
  });

  const p102 = loadList.addLoad({
    tag: 'P-102',
    description: 'Sump Slops Siphon Pump (Intermittent)',
    bus: 'LV-400V',
    shaftPowerKW: 22.0,
    efficiency: 0.91,
    powerFactor: 0.82,
    duty: 'I',
    intermittentFactor: 0.30
  });

  // Add Essential / Emergency Consumer
  const essLtg = loadList.addLoad({
    tag: 'LTG-ESS-01',
    description: 'Control Room Essential Lighting & HVAC',
    bus: 'EMERG-400V',
    shaftPowerKW: 45.0,
    efficiency: 0.92,
    powerFactor: 0.92,
    duty: 'C',
    isEssential: true
  });

  // Add Vital UPS Instrumentation Load (Single Phase 230V)
  const dcsUps = loadList.addLoad({
    tag: 'UPS-DCS-01',
    description: 'DCS & SIS Safety System Cabinets',
    bus: 'UPS-230V',
    shaftPowerKW: 30.0,
    efficiency: 0.90,
    powerFactor: 0.80,
    duty: 'C',
    isEssential: true
  });

  assert.strictEqual(loadList.loads.length, 6);

  // Add custom bus via addBus
  loadList.addBus({ key: 'MV-13.8KV', name: 'Generation 13.8 kV', nominalVoltageKV: 13.8, phase: 3 });
  const genFeeder = loadList.addLoad({
    tag: 'FDR-GEN-01',
    description: 'Auxiliary Transformer Feeder',
    bus: 'MV-13.8KV',
    shaftPowerKW: 2500.0,
    efficiency: 0.98,
    powerFactor: 0.88,
    duty: 'C'
  });
  assert.strictEqual(genFeeder.bus, 'MV-13.8KV');
  assert.strictEqual(genFeeder.voltageKV, 13.8);

  // Pure reactive / zero active power edge case (capacitor bank / idle bus)
  const capBus = loadList.addBus({ key: 'LV-CAP', name: 'PFC Capacitor Bus', nominalVoltageKV: 0.40, phase: 3 });
  loadList.addLoad({
    tag: 'CAP-BANK-01',
    description: 'Power Factor Correction Capacitor Bank',
    bus: 'LV-CAP',
    shaftPowerKW: 0.0,
    powerFactor: 0.05,
    duty: 'C'
  });
  const capDemand = loadList.evaluatePlantDemand({ operatingCase: 'normal' });
  assert.ok(!Number.isNaN(capDemand.buses['LV-CAP'].operatingCurrentAmps), 'Operating current must not be NaN for zero active load');
  assert.strictEqual(capDemand.buses['LV-CAP'].operatingActiveKW, 0);

  // Normal Case Evaluation
  const normalReport = loadList.evaluatePlantDemand({ operatingCase: 'normal', diversityFactor: 0.90 });
  assert.strictEqual(normalReport.operatingCase, 'normal');
  assert.ok(normalReport.plantConnectedActiveMW > normalReport.plantOperatingActiveMW, 'Connected MW exceeds diversified operating MW');
  assert.ok(normalReport.plantOperatingPowerFactor >= 0.85 && normalReport.plantOperatingPowerFactor <= 0.95);
  assert.ok(normalReport.recommendedSubstationCapacityMVA > normalReport.plantOperatingApparentMVA);

  // Peak Case Evaluation (Intermittent loads increased, standby idling)
  const peakReport = loadList.evaluatePlantDemand({ operatingCase: 'peak' });
  assert.ok(peakReport.plantOperatingActiveMW >= normalReport.plantOperatingActiveMW, 'Peak case active power must be >= normal case');

  // Emergency Case Evaluation (Only essential loads powered)
  const emergReport = loadList.evaluatePlantDemand({ operatingCase: 'emergency' });
  assert.ok(emergReport.plantOperatingActiveMW < normalReport.plantOperatingActiveMW * 0.1, 'Emergency case sheds non-essential process loads');
  assert.ok(emergReport.buses['EMERG-400V'].operatingActiveKW > 0);

  // Error handling checks
  assert.throws(() => {
    loadList.addLoad({ tag: 'BAD-BUS', bus: 'NON-EXISTENT-99KV', shaftPowerKW: 100 });
  }, /Invalid or unconfigured bus/);

  assert.throws(() => {
    loadList.addLoad({ tag: 'BAD-EFF', bus: 'LV-400V', shaftPowerKW: 10, efficiency: 1.5 });
  }, /Efficiency must be between 0 and 1.0/);

  assert.throws(() => {
    loadList.addBus({ key: '' });
  }, /Bus key is required/);
});

test('CableSizingIec60364: Ampacity, Derating, Steady-State & Motor Starting Voltage Drop', () => {
  // Scenario 1: LV 400V motor feeder, 160 A design current, 150m route length, ladder in 40C ambient air
  const lvMotorCable = CableSizingIec60364.sizeCable({
    designCurrentAmps: 160.0,
    nominalVoltageV: 400.0,
    routeLengthM: 150.0,
    powerFactor: 0.85,
    insulation: 'XLPE',
    installationMethod: 'cable_ladder',
    ambientTempC: 40,
    numberOfCircuitsGrouped: 3,
    maxVoltageDropPct: 4.0,
    shortCircuitCurrentKA: 25.0,
    faultClearingTimeSec: 0.20,
    isMotorLoad: true,
    motorStartingCurrentRatio: 6.0,
    maxStartingVoltageDropPct: 15.0
  });

  assert.ok(lvMotorCable.sizeMm2 >= 70, 'Must be at least 70 mm² for 160A with derating and voltage drop limits');
  assert.ok(lvMotorCable.deratedAmpacityTotalA >= 160.0, 'Derated ampacity must satisfy design current');
  assert.ok(lvMotorCable.voltageDropPercent <= 4.0, 'Steady-state voltage drop within 4% limit');
  assert.ok(lvMotorCable.motorStartingDipPercent <= 15.0, 'Starting voltage dip within 15% limit');
  assert.strictEqual(lvMotorCable.motorStartingCheckPassed, true);
  assert.ok(lvMotorCable.actualCrossSectionMm2 >= lvMotorCable.minShortCircuitAreaRequiredMm2, 'Must satisfy adiabatic short circuit withstand');
  assert.ok(lvMotorCable.deratingFactors.totalDeratingFactor < 1.0, 'Total derating factor accounts for ambient and grouping');

  // Scenario 2: Large High-Current Feeder requiring parallel runs (1200 A)
  const heavyFeeder = CableSizingIec60364.sizeCable({
    designCurrentAmps: 1200.0,
    nominalVoltageV: 400.0,
    routeLengthM: 80.0,
    powerFactor: 0.88,
    insulation: 'XLPE',
    installationMethod: 'cable_ladder',
    ambientTempC: 35,
    numberOfCircuitsGrouped: 2,
    maxVoltageDropPct: 3.0,
    shortCircuitCurrentKA: 40.0,
    faultClearingTimeSec: 0.15
  });

  assert.ok(heavyFeeder.runs >= 2, 'High current 1200A requires multiple parallel runs');
  assert.ok(heavyFeeder.deratedAmpacityTotalA >= 1200.0);
  assert.ok(heavyFeeder.voltageDropPercent <= 3.0);

  // Scenario 3: Temperature factor formula test
  const k1_air_40 = CableSizingIec60364.getTemperatureFactor(40, 'XLPE', false);
  const k1_air_30 = CableSizingIec60364.getTemperatureFactor(30, 'XLPE', false);
  assert.strictEqual(k1_air_30, 1.0, 'At 30C reference, k1 in air must be 1.0');
  assert.ok(k1_air_40 < 1.0, 'At 40C, k1 must derate (< 1.0)');

  // Scenario 4: Single-Phase 230V Vital UPS Feeder (2-wire drop formula)
  const singlePhaseCable = CableSizingIec60364.sizeCable({
    designCurrentAmps: 35.0,
    nominalVoltageV: 230.0,
    routeLengthM: 60.0,
    phase: 1,
    conductor: 'Cu',
    insulation: 'xlpe', // lowercase check
    powerFactor: 0.90,
    shortCircuitCurrentKA: 10.0,
    maxVoltageDropPct: 3.0
  });
  assert.strictEqual(singlePhaseCable.phase, 1);
  assert.ok(singlePhaseCable.cableDesignation.includes('2C x'), 'Single-phase designates 2-core cable');
  assert.ok(singlePhaseCable.voltageDropPercent <= 3.0);

  // Scenario 5: Aluminum Conductor Feeder
  const alFeeder = CableSizingIec60364.sizeCable({
    designCurrentAmps: 180.0,
    nominalVoltageV: 400.0,
    routeLengthM: 100.0,
    conductor: 'Al',
    insulation: 'XLPE',
    shortCircuitCurrentKA: 15.0,
    maxVoltageDropPct: 4.0
  });
  assert.strictEqual(alFeeder.conductor, 'Al');
  assert.ok(alFeeder.deratedAmpacityTotalA >= 180.0);

  // Error on invalid current
  assert.throws(() => {
    CableSizingIec60364.sizeCable({ designCurrentAmps: -10, nominalVoltageV: 400, routeLengthM: 50 });
  }, /Design current must be greater than zero/);
});

test('ShortCircuitIec60909: Symmetrical 3-Phase Fault, Peak ip & Breaking Current', () => {
  // Model a 33 kV main bus with grid intertie, 45 MVA GTG, and MV motor feedback
  const faultResult = ShortCircuitIec60909.evaluateBusFault({
    busName: 'SWG-33KV-A',
    nominalVoltageKV: 33.0,
    sources: [
      {
        type: 'grid',
        shortCircuitMVA: 1500.0,
        rxRatio: 0.10
      },
      {
        type: 'generator',
        ratedMVA: 53.0,
        ratedVoltageKV: 33.0,
        xdDoublePrime: 0.15,
        powerFactor: 0.85,
        rxRatio: 0.06
      },
      {
        type: 'transformer',
        ratedMVA: 40.0,
        hvVoltageKV: 33.0,
        lvVoltageKV: 11.0,
        impedanceUkPct: 10.0,
        loadLossKW: 160.0
      },
      {
        type: 'motor_group',
        totalRatedMW: 30.0,
        startingCurrentRatio: 5.5,
        efficiency: 0.96,
        powerFactor: 0.89,
        rxRatio: 0.12
      }
    ],
    breakerDelaySec: 0.05
  });

  assert.strictEqual(faultResult.busName, 'SWG-33KV-A');
  assert.strictEqual(faultResult.nominalVoltageKV, 33.0);
  assert.strictEqual(faultResult.voltageFactorC, 1.10, 'c_max for HV > 1 kV is 1.10 per IEC 60909 Table 1');

  const { faultResults, recommendedSwitchgearRatings } = faultResult;

  // Initial symmetrical current Ik''
  assert.ok(faultResults.initialSymmetricalCurrentIkDoublePrimeKA > 20.0, 'Ik" should exceed 20 kA for combined grid + GTG');
  assert.ok(faultResults.shortCircuitMVA > 1500.0, 'Fault MVA exceeds grid contribution alone');

  // Peak making current ip
  assert.ok(faultResults.kappaFactor > 1.6 && faultResults.kappaFactor < 2.0, 'Kappa factor typically 1.6-1.9 for low R/X');
  assert.ok(faultResults.peakShortCircuitCurrentIpKA > faultResults.initialSymmetricalCurrentIkDoublePrimeKA * Math.sqrt(2));

  // Breaking current Ib (AC decay present due to GTGs)
  assert.ok(faultResults.breakingCurrentIbKA <= faultResults.initialSymmetricalCurrentIkDoublePrimeKA, 'Ib <= Ik" due to AC decay');

  // Switchgear recommendations
  assert.ok(recommendedSwitchgearRatings.minimumBreakingCapacityIcuKA >= faultResults.initialSymmetricalCurrentIkDoublePrimeKA);
  assert.ok(recommendedSwitchgearRatings.minimumMakingCapacityIcmKA >= faultResults.peakShortCircuitCurrentIpKA);

  // Method C kappa calculation test
  const kappaZeroRx = ShortCircuitIec60909.calculateKappaFactor(0.0);
  assert.strictEqual(Math.round(kappaZeroRx * 100) / 100, 2.0, 'Kappa at R/X = 0 is 2.0');

  // Far-From-Generator Fault Check: Grid + Transformer only (No generators -> mu = 1.0, Ib = Ik'')
  const gridOnlyFault = ShortCircuitIec60909.evaluateBusFault({
    busName: 'SWG-11KV-UTILITY',
    nominalVoltageKV: 11.0,
    sources: [
      { type: 'grid', shortCircuitMVA: 800.0, rxRatio: 0.10 },
      { type: 'transformer', ratedMVA: 25.0, hvVoltageKV: 33.0, lvVoltageKV: 11.0, impedanceUkPct: 8.0 }
    ]
  });
  assert.strictEqual(gridOnlyFault.faultResults.muBreakingFactor, 1.0, 'Far-from-generator fault has mu = 1.0 per IEC 60909');
  assert.strictEqual(gridOnlyFault.faultResults.breakingCurrentIbKA, gridOnlyFault.faultResults.initialSymmetricalCurrentIkDoublePrimeKA);
});

test('TransformerGeneratorSizing: Transformer Ratings, GTG N+1 Redundancy & Motor Starting Dip', () => {
  // 1. Step-down Transformer Sizing
  const trafo = TransformerGeneratorSizing.sizeTransformer({
    operatingLoadMVA: 18.5,
    primaryVoltageKV: 33.0,
    secondaryVoltageKV: 6.6,
    designMarginPct: 20.0,
    ambientTempC: 42
  });

  assert.strictEqual(trafo.primaryVoltageKV, 33.0);
  assert.strictEqual(trafo.secondaryVoltageKV, 6.6);
  assert.ok(trafo.ratedCapacityOnanMVA >= 25.0, 'Should select standard 25 MVA or higher');
  assert.ok(trafo.ratedCapacityOnafMVA > trafo.ratedCapacityOnanMVA, 'ONAF rating exceeds ONAN');
  assert.ok(trafo.efficiencyAtFullLoadPercent > 98.5, 'Power transformer efficiency > 98.5%');
  assert.strictEqual(trafo.tapChanger.stepsCount, 16);

  // 2. Gas Turbine Generator (GTG) Sizing & Redundancy
  const gtg = TransformerGeneratorSizing.sizeGasTurbineGenerators({
    peakPlantDemandMW: 95.0,
    plantPowerFactor: 0.85,
    isoRatingPerGtgMW: 42.0,
    siteAmbientTempC: 40,
    altitudeM: 30,
    inletPressureLossMbar: 10,
    exhaustPressureLossMbar: 25,
    spinningReserveMarginPct: 10.0
  });

  assert.ok(gtg.siteDerateFactor < 1.0, 'Site derating factor accounts for 40C ambient');
  assert.ok(gtg.siteRatedGtgMW < 42.0, 'Site MW is derated from ISO 42 MW');
  assert.strictEqual(gtg.unitsInstalled, gtg.unitsRunning + 1, 'N+1 redundancy configuration');
  assert.strictEqual(gtg.firmCapacityAdequate, true, 'N running units supply peak demand');
  assert.ok(gtg.reactiveCapabilityMVAR.maxLaggingAt080PF > 0);

  // 3. Motor Starting Transient Voltage Dip
  const dolStartPass = TransformerGeneratorSizing.evaluateMotorStartingDip({
    motorShaftPowerKW: 1800.0,
    motorNominalVoltageKV: 6.6,
    busFaultLevelMVA: 350.0,
    startingCurrentRatio: 5.5,
    maxAllowableDipPct: 15.0
  });

  assert.strictEqual(dolStartPass.isDolAcceptable, true, 'Small motor on strong bus passes DOL dip <= 15%');
  assert.strictEqual(dolStartPass.starterRecommendation, 'Direct-On-Line (DOL)');

  const dolStartFail = TransformerGeneratorSizing.evaluateMotorStartingDip({
    motorShaftPowerKW: 15000.0, // Huge 15 MW motor
    motorNominalVoltageKV: 6.6,
    busFaultLevelMVA: 120.0, // Weak bus
    startingCurrentRatio: 6.0,
    maxAllowableDipPct: 15.0
  });

  assert.strictEqual(dolStartFail.isDolAcceptable, false, 'Large motor on weak bus produces excessive voltage dip');
  assert.ok(dolStartFail.transientVoltageDipPercent > 15.0);
  assert.ok(dolStartFail.starterRecommendation.includes('VFD') || dolStartFail.starterRecommendation.includes('Starter'));
});

test('SingleLineDiagramGenerator: Structured Topology & Industrial SVG Output', () => {
  const topology = SingleLineDiagramGenerator.buildPlantTopology({
    plantName: 'World-Scale LNG Export Terminal'
  });

  assert.strictEqual(topology.plantName, 'World-Scale LNG Export Terminal');
  assert.ok(topology.buses.length >= 6, 'Includes 33kV, 6.6kV, 400V, Emergency, and UPS buses');
  assert.ok(topology.generators.length >= 4, 'Includes GTGs and EDG');
  assert.ok(topology.transformers.length >= 4, 'Includes main and distribution transformers');
  assert.ok(topology.busTieBreakers.length >= 3, 'Includes bus-tie breakers with interlocks');

  // SVG Generation Check
  const svg = SingleLineDiagramGenerator.generateSvgDiagram({
    plantName: 'World-Scale LNG Export Terminal'
  });

  assert.strictEqual(typeof svg, 'string');
  assert.ok(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Valid XML/SVG header');
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'), 'SVG root element');
  assert.ok(svg.includes('id="BUS-33A"'), 'Contains main 33kV Bus A');
  assert.ok(svg.includes('id="BUS-33B"'), 'Contains main 33kV Bus B');
  assert.ok(svg.includes('id="GTG-1"'), 'Contains GTG-1 generator symbol');
  assert.ok(svg.includes('id="T-01A"'), 'Contains transformer T-01A');
  assert.ok(svg.includes('id="title-block"'), 'Contains drawing title block');
  assert.ok(svg.includes('id="legend"'), 'Contains voltage level color legend');
  assert.ok(svg.includes('</svg>'), 'Closes SVG tag');
});

test('PlantEngineeringMasterApi: Electrical Discipline Integration', () => {
  const master = PlantEngineeringMasterApi;
  assert.ok(master.electrical, 'Electrical discipline exposed on Master API');
  assert.strictEqual(typeof master.electrical.ElectricalLoadList, 'function');
  assert.strictEqual(typeof master.electrical.CableSizingIec60364, 'function');
  assert.strictEqual(typeof master.electrical.ShortCircuitIec60909, 'function');
  assert.strictEqual(typeof master.electrical.TransformerGeneratorSizing, 'function');
  assert.strictEqual(typeof master.electrical.SingleLineDiagramGenerator, 'function');
});
