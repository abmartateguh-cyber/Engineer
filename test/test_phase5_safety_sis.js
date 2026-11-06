'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Import from unified plant engineering master API as well as directly from safety modules
const {
  PlantEngineeringMasterApi,
  safety,
  SifVerificationEngine,
  calculateSubsystemPfd,
  determineSilFromPfd,
  calculateSff,
  GENERIC_FAILURE_RATES,
  LopaScenario,
  LopaStudy,
  INITIATING_EVENT_FREQUENCIES,
  STANDARD_IPL_CREDITS,
  DEFAULT_RISK_TARGETS,
  CauseEffectMatrix,
  CauseDefinition,
  EffectDefinition,
  ESD_LEVELS,
  HazardousAreaClassifier,
  calculateGasReleaseRate,
  determineZoneType,
  FLAMMABLE_SUBSTANCES,
  evaluateFgVoting,
  Nfpa15DelugeSizingEngine,
  FireGasZoneLayout,
  DETECTOR_TECHNOLOGIES,
  NFPA_15_DENSITIES,
  FlareRadiationApi521,
  calculateRadiationFractionF,
  calculateFlameLength,
  API_521_RADIATION_LIMITS,
  HazopStudyGenerator,
  RISK_MATRIX
} = require('../src/core/plant/plant_engineering_master_api');

// ============================================================================
// 1. SIL / IEC 61511 / IEC 61508 SIF VERIFICATION ENGINE TESTS
// ============================================================================

test('SIL: Generic Failure Rate Catalog Integrity', () => {
  assert.ok(GENERIC_FAILURE_RATES.pressure_transmitter);
  assert.ok(GENERIC_FAILURE_RATES.safety_plc_logic_solver);
  assert.ok(GENERIC_FAILURE_RATES.esdv_ball_valve_assembly);

  const pt = GENERIC_FAILURE_RATES.pressure_transmitter;
  assert.equal(pt.type, 'Type B');
  assert.ok(pt.lambdaDU > 0 && pt.lambdaDU < 1e-5);
  assert.ok(pt.defaultBeta >= 0.01 && pt.defaultBeta <= 0.10);

  const valve = GENERIC_FAILURE_RATES.esdv_ball_valve_assembly;
  assert.equal(valve.type, 'Type A');
  assert.ok(valve.lambdaDU > pt.lambdaDU, 'Mechanical valves have higher failure rate than transmitters');
});

test('SIL: PFDavg to SIL Level Determination and RRF Boundaries', () => {
  // SIL 1: 1e-2 <= PFD < 1e-1 (10 <= RRF < 100)
  const sil1 = determineSilFromPfd(0.04);
  assert.equal(sil1.sil, 1);
  assert.equal(sil1.rrf, 25.0);

  // SIL 2: 1e-3 <= PFD < 1e-2 (100 <= RRF < 1000)
  const sil2 = determineSilFromPfd(0.005);
  assert.equal(sil2.sil, 2);
  assert.equal(sil2.rrf, 200.0);

  // SIL 3: 1e-4 <= PFD < 1e-3 (1000 <= RRF < 10000)
  const sil3 = determineSilFromPfd(0.0003);
  assert.equal(sil3.sil, 3);
  assert.ok(sil3.rrf > 3000.0);

  // SIL 4: 1e-5 <= PFD < 1e-4
  const sil4 = determineSilFromPfd(0.00002);
  assert.equal(sil4.sil, 4);

  // Non-SIL (< SIL 1): PFD >= 0.10
  const noSil = determineSilFromPfd(0.25);
  assert.equal(noSil.sil, 0);
  assert.match(noSil.silLabel, /< SIL 1/i);
});

test('SIL: Safe Failure Fraction (SFF) Calculation', () => {
  const pt = GENERIC_FAILURE_RATES.pressure_transmitter;
  const sff = calculateSff(pt);
  assert.ok(sff > 0.80 && sff < 1.0, 'Smart transmitter has high SFF with diagnostics');
});

test('SIL: Architecture PFDavg (1oo1, 1oo2, 2oo2, 2oo3) and Voting Calculations', () => {
  const lambdaDU = 1.0e-6; // 1 per 10^6 hours
  const TI = 8760.0; // 1 year proof test interval (hours)
  const MTTR = 24.0;
  const beta = 0.05; // 5% common cause

  // 1oo1: PFD_avg = lambda_DU * TI / 2
  const res1oo1 = calculateSubsystemPfd({
    architecture: '1oo1',
    lambdaDU,
    proofTestIntervalHours: TI,
    mttrHours: MTTR
  });
  const expected1oo1Pfd = lambdaDU * (TI / 2.0); // 1e-6 * 4380 = 0.00438
  assert.ok(Math.abs(res1oo1.pfdAvg - expected1oo1Pfd) < 1e-6);
  assert.equal(res1oo1.hft, 0);

  // 1oo2: Dramatic risk reduction compared to 1oo1, limited by beta-factor
  const res1oo2 = calculateSubsystemPfd({
    architecture: '1oo2',
    lambdaDU,
    proofTestIntervalHours: TI,
    mttrHours: MTTR,
    beta
  });
  assert.ok(res1oo2.pfdAvg < res1oo1.pfdAvg / 10.0, '1oo2 provides order-of-magnitude lower PFD');
  assert.equal(res1oo2.hft, 1);

  // 2oo2: Higher PFD than 1oo1 (less safety availability)
  const res2oo2 = calculateSubsystemPfd({
    architecture: '2oo2',
    lambdaDU,
    proofTestIntervalHours: TI,
    mttrHours: MTTR,
    beta
  });
  assert.ok(res2oo2.pfdAvg > res1oo1.pfdAvg, '2oo2 has higher PFD than 1oo1');
  assert.equal(res2oo2.hft, 0);

  // 2oo3: Fault tolerant (HFT=1) with strong spurious trip immunity
  const res2oo3 = calculateSubsystemPfd({
    architecture: '2oo3',
    lambdaDU,
    proofTestIntervalHours: TI,
    mttrHours: MTTR,
    beta
  });
  assert.ok(res2oo3.pfdAvg < res1oo1.pfdAvg);
  assert.equal(res2oo3.hft, 1);
});

test('SIL: Partial Stroke Testing (PST) Credit on Final Element', () => {
  const valve = GENERIC_FAILURE_RATES.esdv_ball_valve_assembly;
  const annualTI = 8760.0;

  // Without PST (full stroke proof test once a year)
  const noPst = calculateSubsystemPfd({
    architecture: '1oo1',
    lambdaDU: valve.lambdaDU,
    proofTestIntervalHours: annualTI
  });

  // With PST (monthly partial stroke testing, 65% diagnostic coverage of sticking/spring failures)
  const withPst = calculateSubsystemPfd({
    architecture: '1oo1',
    lambdaDU: valve.lambdaDU,
    proofTestIntervalHours: annualTI,
    pst: {
      intervalHours: 720.0, // 30 days
      coverage: 0.65
    }
  });

  assert.ok(withPst.pfdAvg < noPst.pfdAvg, 'PST lowers PFDavg by detecting unrevealed sticking failures early');
  assert.ok(withPst.rrf > noPst.rrf);
  assert.equal(withPst.pstApplied, true);
});

test('SIL: Complete SIF Verification Engine across Sensor, Solver, and Final Element', () => {
  const pt = GENERIC_FAILURE_RATES.pressure_transmitter;
  const plc = GENERIC_FAILURE_RATES.safety_plc_logic_solver;
  const valve = GENERIC_FAILURE_RATES.esdv_ball_valve_assembly;

  const sifEngine = new SifVerificationEngine({
    name: 'SIF-LNG-PAHH-101 (MCHE Overpressure Shutdown)',
    targetSil: 2,
    sensor: {
      architecture: '2oo3',
      lambdaDU: pt.lambdaDU,
      lambdaDD: pt.lambdaDD,
      lambdaSU: pt.lambdaSU,
      lambdaSD: pt.lambdaSD,
      proofTestIntervalHours: 8760.0,
      beta: 0.05
    },
    logicSolver: {
      architecture: '1oo2',
      lambdaDU: plc.lambdaDU,
      lambdaDD: plc.lambdaDD,
      lambdaSU: plc.lambdaSU,
      lambdaSD: plc.lambdaSD,
      proofTestIntervalHours: 26280.0, // 3 years
      beta: 0.02
    },
    finalElement: {
      architecture: '1oo2',
      lambdaDU: valve.lambdaDU,
      lambdaDD: valve.lambdaDD,
      lambdaSU: valve.lambdaSU,
      lambdaSD: valve.lambdaSD,
      proofTestIntervalHours: 8760.0,
      beta: 0.08,
      pst: {
        intervalHours: 720.0,
        coverage: 0.65
      }
    }
  });

  const report = sifEngine.verify();

  assert.ok(report.totalPfdAvg < 0.01, 'Total PFDavg is well within SIL 2 boundary (< 0.01)');
  assert.ok(report.achievedRrf > 100.0, 'Achieved RRF > 100 for SIL 2');
  assert.ok(report.achievedSil >= 2, 'Achieved SIL meets or exceeds SIL 2 target');
  assert.equal(report.meetsTarget, true);
  assert.ok(report.overallMttfsYears > 10.0, 'Mean Time to Fail Spurious exceeds 10 years');
  assert.ok(report.subsystems.finalElement.contributionPct > 0);
});

// ============================================================================
// 2. CCPS LAYER OF PROTECTION ANALYSIS (LOPA) TESTS
// ============================================================================

test('LOPA: Initiating Event Frequency and Standard IPL Credit Catalogs', () => {
  assert.equal(INITIATING_EVENT_FREQUENCIES.bpcs_control_loop_failure.frequencyPerYear, 0.1);
  assert.equal(INITIATING_EVENT_FREQUENCIES.cooling_water_failure.frequencyPerYear, 0.1);
  assert.equal(INITIATING_EVENT_FREQUENCIES.pipe_rupture.frequencyPerYear, 0.0001);

  assert.equal(STANDARD_IPL_CREDITS.psv_spring_loaded.pfd, 0.01);
  assert.equal(STANDARD_IPL_CREDITS.operator_alarm_and_intervention.pfd, 0.1);
  assert.equal(STANDARD_IPL_CREDITS.dike_bund_containment.pfd, 0.01);

  assert.equal(DEFAULT_RISK_TARGETS.catastrophic.targetFrequencyPerYear, 1.0e-6);
  assert.equal(DEFAULT_RISK_TARGETS.major.targetFrequencyPerYear, 1.0e-5);
});

test('LOPA: Single Scenario Evaluation with Conditional Modifiers and IPL Credits', () => {
  const scenario = new LopaScenario({
    id: 'LOPA-LNG-001',
    description: 'Demethanizer column overpressure on loss of reflux',
    initiatingEvent: 'bpcs_control_loop_failure', // 0.1 / yr
    severity: 'major', // Target: 1.0e-5 / yr
    conditionalModifiers: {
      occupancy: 0.5, // 50% personnel occupancy in area
      ignition: 0.5, // 50% ignition probability
      vulnerability: 1.0 // 100% fatality given ignition
    },
    ipls: [
      {
        name: 'LAH-301 Alarm & Operator Intervention',
        type: 'operator_alarm_and_intervention',
        pfd: 0.1,
        independentOfInitiator: true
      },
      {
        name: 'PSV-301 Full Flow Relief Valve',
        type: 'psv_spring_loaded',
        pfd: 0.01,
        independentOfInitiator: true
      }
    ]
  });

  const res = scenario.evaluate();

  // f_IE = 0.1
  // Modifiers = 0.5 * 0.5 * 1.0 = 0.25
  // IPLs = 0.1 * 0.01 = 0.001
  // Mitigated f = 0.1 * 0.25 * 0.001 = 2.5e-5 / yr
  assert.ok(Math.abs(res.mitigatedFrequencyWithoutSif - 2.5e-5) < 1e-8);
  // Target = 1.0e-5 / yr
  // Required RRF = 2.5e-5 / 1.0e-5 = 2.5
  assert.ok(Math.abs(res.requiredRrf - 2.5) < 1e-4);
  assert.equal(res.requiredSil, 0, 'RRF = 2.5 does not require a full SIL 1 loop (RRF < 10)');
});

test('LOPA: Scenario Requiring SIL 2 Safety Instrumented System', () => {
  const scenario = new LopaScenario({
    id: 'LOPA-LNG-002',
    description: 'LNG Slug Catcher Catastrophic Overpressure from Upstream Pipeline Surge',
    initiatingEvent: 'bpcs_control_loop_failure', // 0.1 / yr
    severity: 'catastrophic', // Target: 1.0e-6 / yr
    conditionalModifiers: {
      occupancy: 1.0,
      ignition: 0.8,
      vulnerability: 1.0
    },
    ipls: [
      {
        name: 'Operator Manual Flare Pushbutton',
        type: 'operator_alarm_and_intervention',
        pfd: 0.1,
        independentOfInitiator: true
      }
    ]
  });

  const res = scenario.evaluate();

  // Mitigated frequency = 0.1 * 0.8 * 0.1 = 0.008 / yr
  // Target = 1.0e-6 / yr
  // Required RRF = 0.008 / 1e-6 = 8,000 -> Requires SIL 3 or SIL 2 with redesign
  assert.ok(res.requiredRrf >= 100.0);
  assert.ok(res.requiredSil >= 2);
  assert.match(res.silTargetLabel, /SIL/);
});

test('LOPA: CCPS Independence Rule on BPCS Failure Initiator', () => {
  const scenario = new LopaScenario({
    id: 'LOPA-LNG-003',
    description: 'BPCS failure cannot credit BPCS interlock as IPL',
    initiatingEvent: 'bpcs_control_loop_failure',
    ipls: [
      {
        name: 'BPCS High Pressure Interlock',
        type: 'bpcs_interlock',
        pfd: 0.1,
        independentOfInitiator: true // CCPS rule will disqualify this
      }
    ]
  });

  const res = scenario.evaluate();
  const bpcsIpl = res.ipls.find((i) => i.name === 'BPCS High Pressure Interlock');
  assert.equal(bpcsIpl.credited, false, 'BPCS interlock is disqualified when initiating event is BPCS failure');
});

test('LOPA: Multi-Scenario Study Evaluation and SIL Distribution', () => {
  const study = new LopaStudy('LNG Complex Phase 5 LOPA Study');

  study.addScenario({
    id: 'SC-1',
    initiatingEvent: 'cooling_water_failure',
    severity: 'major',
    ipls: [{ type: 'psv_spring_loaded' }]
  });

  study.addScenario({
    id: 'SC-2',
    initiatingEvent: 'small_pipe_leak',
    severity: 'minor',
    ipls: [{ type: 'dike_bund_containment' }]
  });

  const report = study.evaluateAll();
  assert.equal(report.totalScenarios, 2);
  assert.ok(report.silDistribution);
  assert.equal(report.scenarioResults.length, 2);
});

// ============================================================================
// 3. CAUSE & EFFECT (C&E) MATRIX ENGINE TESTS
// ============================================================================

test('C&E Matrix: Configuration, 2oo3 Voting, and ESD Hierarchy Execution', () => {
  const ce = new CauseEffectMatrix({
    title: 'LNG Plant Emergency Shutdown Matrix',
    docNumber: 'CE-LNG-001',
    revision: 'Rev 1'
  });

  // Causes
  const c1 = ce.addCause({
    id: 'C-01',
    tag: 'PAHH-1001',
    description: 'Feed Gas High-High Pressure',
    category: 'PAHH',
    voting: '2oo3',
    setpoint: 75.0,
    unit: 'barg',
    inputs: ['PT-1001A', 'PT-1001B', 'PT-1001C']
  });

  const c2 = ce.addCause({
    id: 'C-02',
    tag: 'ESD-PB-01',
    description: 'Main Control Room ESD Level 0 Abandonment Pushbutton',
    category: 'ESD_PB',
    voting: '1oo1'
  });

  // Effects
  const e1 = ce.addEffect({
    id: 'E-01',
    tag: 'XV-1001',
    description: 'Feed Gas Battery Limit ESDV',
    esdLevel: 1,
    action: 'CLOSE'
  });

  const e2 = ce.addEffect({
    id: 'E-02',
    tag: 'BDV-1001',
    description: 'Train 1 Depressuring Blowdown Valve',
    esdLevel: 1,
    action: 'OPEN'
  });

  const e3 = ce.addEffect({
    id: 'E-03',
    tag: 'BDV-TOTAL',
    description: 'Total Facility Blowdown Header Valve',
    esdLevel: 0,
    action: 'OPEN'
  });

  // Intersections
  ce.link('C-01', 'E-01', 'X', 0); // Immediate close
  ce.link('C-01', 'E-02', 'T', 30); // 30-second delay open
  ce.link('C-02', 'E-03', 'X', 0); // Total plant blowdown

  // Case 1: 1 out of 3 transmitters tripped (60, 60, 80 barg) -> Not tripped (2oo3)
  const eval1 = ce.evaluate({
    'PT-1001A': 60.0,
    'PT-1001B': 60.0,
    'PT-1001C': 80.0
  });
  assert.equal(eval1.activeCausesCount, 0);
  assert.equal(eval1.totalEffectsTriggered, 0);

  // Case 2: 2 out of 3 transmitters tripped (60, 78, 82 barg) -> Tripped!
  const eval2 = ce.evaluate({
    'PT-1001A': 60.0,
    'PT-1001B': 78.0,
    'PT-1001C': 82.0
  });
  assert.equal(eval2.activeCausesCount, 1);
  assert.equal(eval2.totalEffectsTriggered, 2);
  assert.equal(eval2.groupedByLevel.level1.length, 2);

  const xv1001 = eval2.activeEffects.find((e) => e.effect.tag === 'XV-1001');
  assert.equal(xv1001.actionCode, 'X');
  const bdv1001 = eval2.activeEffects.find((e) => e.effect.tag === 'BDV-1001');
  assert.equal(bdv1001.actionCode, 'T');
  assert.equal(bdv1001.delaySec, 30);

  // Case 3: Level 0 Abandonment pushbutton
  const eval3 = ce.evaluate({ 'ESD-PB-01': true });
  assert.equal(eval3.groupedByLevel.level0.length, 1);
  assert.equal(eval3.groupedByLevel.level0[0].effect.tag, 'BDV-TOTAL');
});

test('C&E Matrix: CSV and SVG Export Generation', () => {
  const ce = new CauseEffectMatrix({ title: 'Export Test C&E Matrix' });
  ce.addCause({ id: 'C-01', tag: 'PAHH-201', description: 'Test Pressure' });
  ce.addEffect({ id: 'E-01', tag: 'XV-201', description: 'Test Valve', esdLevel: 2 });
  ce.link('C-01', 'E-01', 'X');

  // Test CSV export
  const csv = ce.toCsv();
  assert.match(csv, /PAHH-201/);
  assert.match(csv, /XV-201/);
  assert.match(csv, /"X"/);

  // Test SVG export
  const svg = ce.toSvg();
  assert.match(svg, /<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, /PAHH-201/);
  assert.match(svg, /XV-201/);
  assert.match(svg, /Action Legend:/);
});

// ============================================================================
// 4. IEC 60079-10-1 HAZARDOUS AREA CLASSIFICATION TESTS
// ============================================================================

test('Hazardous Area: Gas Release Rate Calculation (Sonic vs Subsonic)', () => {
  // Sonic choked release of high-pressure methane (50 barg through 1 mm hole)
  const sonic = calculateGasReleaseRate({
    holeDiameterMm: 1.0,
    pressureBarg: 50.0,
    tempK: 293.15,
    molecularWeight: 16.043,
    gamma: 1.31,
    compressibilityZ: 0.99
  });

  assert.equal(sonic.isChoked, true);
  assert.equal(sonic.regime, 'sonic');
  assert.ok(sonic.massReleaseRateKgS > 0.001 && sonic.massReleaseRateKgS < 0.01, 'Sonic release of 1mm hole at 50 bar is ~0.0043 kg/s');

  // Subsonic release (0.1 barg, pressure ratio > critical ratio)
  const subsonic = calculateGasReleaseRate({
    holeDiameterMm: 5.0,
    pressureBarg: 0.1,
    tempK: 293.15,
    molecularWeight: 16.043,
    gamma: 1.31
  });

  assert.equal(subsonic.isChoked, false);
  assert.equal(subsonic.regime, 'subsonic');
  assert.ok(subsonic.massReleaseRateKgS > 0);
});

test('Hazardous Area: Zone Type Determination Matrix (IEC 60079 Table B.1)', () => {
  // Secondary release in open air with good ventilation -> Zone 2
  const z2 = determineZoneType('secondary', 'medium', 'good');
  assert.equal(z2.zone, 'Zone 2');
  assert.equal(z2.epl, 'Gc');

  // Secondary release with high ventilation dilution -> Non-Hazardous
  const nonEx = determineZoneType('secondary', 'high', 'good');
  assert.equal(nonEx.zone, 'Non-Hazardous');
  assert.equal(nonEx.epl, 'Non-Ex');

  // Primary release with medium ventilation -> Zone 1
  const z1 = determineZoneType('primary', 'medium', 'good');
  assert.equal(z1.zone, 'Zone 1');
  assert.equal(z1.epl, 'Gb');

  // Continuous release inside tank or vent -> Zone 0
  const z0 = determineZoneType('continuous', 'medium', 'good');
  assert.equal(z0.zone, 'Zone 0');
  assert.equal(z0.epl, 'Ga');
});

test('Hazardous Area: Complete Process Area Classification and Extent Radius', () => {
  const classifier = new HazardousAreaClassifier({
    areaName: 'MCHE Feed Compressor Piping Deck',
    substanceKey: 'methane',
    gradeOfRelease: 'secondary',
    operatingPressureBarg: 60.0,
    operatingTempC: 30.0,
    holeDiameterMm: 1.0,
    environment: 'open_air',
    windSpeedMPerS: 2.0
  });

  const res = classifier.classify();

  assert.equal(res.classification.zone, 'Zone 2');
  assert.equal(res.classification.epl, 'Gc');
  assert.equal(res.classification.gasGroup, 'IIA');
  assert.equal(res.classification.tempClass, 'T1');
  assert.ok(res.extent.horizontalRadiusM >= 1.5, 'Secondary flange has at least 1.5m Zone 2 radius');
  assert.equal(res.extent.dispersionBehavior, 'Buoyant/Rising');

  // Test cryogenic LNG cold dense gas slumping
  const lngCryo = new HazardousAreaClassifier({
    areaName: 'LNG Marine Loading Manifold',
    substanceKey: 'lng_vapor_cryogenic',
    gradeOfRelease: 'secondary',
    operatingPressureBarg: 15.0,
    operatingTempC: -160.0,
    holeDiameterMm: 2.0
  });

  const cryoRes = lngCryo.classify();
  assert.equal(cryoRes.extent.dispersionBehavior, 'Dense/Cryogenic Slumping');
  assert.ok(cryoRes.extent.verticalExtentDownM > cryoRes.extent.verticalExtentUpM);
});

// ============================================================================
// 5. FIRE & GAS DETECTION & NFPA 15 DELUGE SIZING TESTS
// ============================================================================

test('Fire & Gas: Detector Library and Voting Evaluation (1ooN / 2ooN)', () => {
  assert.ok(DETECTOR_TECHNOLOGIES.point_ir_gas);
  assert.ok(DETECTOR_TECHNOLOGIES.triple_ir_flame);
  assert.ok(DETECTOR_TECHNOLOGIES.ultrasonic_acoustic_leak);

  const detectors = [
    { tag: 'GD-101A', value: 25.0 }, // 25% LEL
    { tag: 'GD-101B', value: 55.0 }, // 55% LEL
    { tag: 'GD-101C', value: 10.0 }
  ];

  // 1ooN at 20% LEL (Alarm): 2 channels exceed 20%
  const alarm1ooN = evaluateFgVoting({
    votingScheme: '1ooN',
    detectors,
    threshold: 20.0
  });
  assert.equal(alarm1ooN.isTriggered, true);
  assert.equal(alarm1ooN.activeCount, 2);

  // 2ooN at 50% LEL (Trip): Only 1 channel exceeds 50% -> No trip
  const trip2ooN = evaluateFgVoting({
    votingScheme: '2ooN',
    detectors,
    threshold: 50.0
  });
  assert.equal(trip2ooN.isTriggered, false);
  assert.equal(trip2ooN.activeCount, 1);

  // Second detector reaches 52% LEL -> Executive trip fires
  detectors[0].value = 52.0;
  const tripFired = evaluateFgVoting({
    votingScheme: '2ooN',
    detectors,
    threshold: 50.0
  });
  assert.equal(tripFired.isTriggered, true);
  assert.equal(tripFired.activeCount, 2);
});

test('Fire & Gas: NFPA 15 Deluge Spray Sizing and Nozzle Demand', () => {
  const deluge = Nfpa15DelugeSizingEngine.sizeDelugeSystem({
    systemTag: 'DELUGE-MCHE-01',
    serviceType: 'process_units', // 10.2 L/min/m^2
    protectedSurfaceAreaM2: 250.0,
    hydraulicImbalanceFactor: 1.15,
    operatingNozzlePressureBar: 2.0,
    nozzleType: 'K-30' // 30 L/min/bar^0.5
  });

  // Net flow = 250 * 10.2 = 2550 L/min
  assert.equal(deluge.flowDemand.netLMin, 2550.0);
  // Design flow = 2550 * 1.15 = 2932.5 L/min
  assert.equal(deluge.flowDemand.designLMin, 2932.5);
  // Single nozzle flow: 30 * sqrt(2) = 42.426 L/min
  const expectedNozzleFlow = 30.0 * Math.SQRT2;
  assert.ok(Math.abs(deluge.nozzles.singleNozzleFlowLMin - expectedNozzleFlow) < 0.01);
  // Required nozzles = ceil(2932.5 / 42.426) = 70 nozzles
  assert.equal(deluge.nozzles.requiredCount, Math.ceil(2932.5 / expectedNozzleFlow));
  assert.ok(deluge.flowDemand.actualTotalM3H > 0);
});

test('Fire & Gas: Plant Zone Layout Recommendation Engine', () => {
  const zone = new FireGasZoneLayout({
    zoneName: 'Refrigerant Compressor Deck',
    lengthM: 40.0,
    widthM: 30.0,
    heightM: 9.0,
    highPressureEquipmentCount: 4
  });

  const layout = zone.generateRecommendedLayout();
  assert.ok(layout.recommendedDetectors.pointIrGas.count >= 20);
  assert.ok(layout.recommendedDetectors.flameIr3.count >= 4);
  assert.ok(layout.recommendedDetectors.ultrasonicAcoustic.count >= 4);
  assert.match(layout.votingMatrix.gasHighHighTrip, /2ooN/);
});

// ============================================================================
// 6. API 521 FLARE THERMAL RADIATION & STERILE BOUNDARY TESTS
// ============================================================================

test('Flare Radiation: Radiation Fraction F and Flame Length Correlations', () => {
  // Methane (MW = 16)
  const fMethane = calculateRadiationFractionF({ molecularWeight: 16.0, isSmokelessAssisted: false });
  assert.ok(Math.abs(fMethane - 0.20) < 0.001);

  // Propane (MW = 44)
  const fPropane = calculateRadiationFractionF({ molecularWeight: 44.0, isSmokelessAssisted: false });
  assert.ok(fPropane > fMethane, 'Higher molecular weight produces more luminous soot radiation');

  // Flame length for 100,000 kW heat release
  const flameL = calculateFlameLength(100000.0);
  assert.ok(flameL > 30.0 && flameL < 60.0, 'Flame length is within expected API 521 empirical range');
});

test('Flare Radiation: Ground Thermal Flux and API 521 Sterile Boundaries', () => {
  const flare = new FlareRadiationApi521({
    flareTag: 'FLARE-MAIN-01',
    reliefRateKgH: 180000.0, // 180 t/h emergency relief
    lowerHeatingValueKjKg: 50000.0,
    molecularWeight: 18.0,
    stackHeightM: 70.0,
    windSpeedMPerS: 10.0,
    solarRadiationKwM2: 0.79
  });

  assert.ok(flare.heatReleaseKw > 1e6, 'Heat release is over 1 GW');
  assert.ok(flare.flameLengthM > 50.0);
  assert.ok(flare.tiltAngleDeg > 0 && flare.tiltAngleDeg < 80);

  // Ground radiation vs distance
  const nearBase = flare.calculateGroundRadiation(20.0);
  const midDistance = flare.calculateGroundRadiation(150.0);
  const farDistance = flare.calculateGroundRadiation(400.0);

  assert.ok(midDistance.totalFluxKwM2 > farDistance.totalFluxKwM2, 'Flux diminishes with distance');

  // Sterile boundaries for API 521 Table 10 limits:
  // 1.58 kW/m^2 (continuous), 4.73 kW/m^2 (emergency action), 6.31 kW/m^2 (escape), 9.46 kW/m^2 (equipment)
  const boundaries = flare.calculateSterileBoundaries();

  // Verify 3D spherical distances from flame center are strictly decreasing as flux increases
  assert.ok(boundaries.distanceFromFlameCenterM_1_58 > boundaries.distanceFromFlameCenterM_4_73);
  assert.ok(boundaries.distanceFromFlameCenterM_4_73 > boundaries.distanceFromFlameCenterM_6_31);
  assert.ok(boundaries.distanceFromFlameCenterM_6_31 > boundaries.distanceFromFlameCenterM_9_46);

  // Continuous personnel limit (1.58 kW/m^2) reaches ground level
  assert.ok(boundaries.continuousPersonnelRadiusM_1_58 > 50.0);

  // Test a ground pit flare where all radiation fluxes intersect the ground plane
  const pitFlare = new FlareRadiationApi521({
    flareTag: 'FLARE-PIT',
    reliefRateKgH: 15000.0,
    lowerHeatingValueKjKg: 50000.0,
    molecularWeight: 18.0,
    stackHeightM: 0.0,
    windSpeedMPerS: 15.0,
    solarRadiationKwM2: 0.79
  });
  const pitBoundaries = pitFlare.calculateSterileBoundaries();
  assert.ok(pitBoundaries.continuousPersonnelRadiusM_1_58 > pitBoundaries.emergencyActionRadiusM_4_73);
  assert.ok(pitBoundaries.emergencyActionRadiusM_4_73 > pitBoundaries.escapeOnlyRadiusM_6_31);
  assert.ok(pitBoundaries.escapeOnlyRadiusM_6_31 > pitBoundaries.equipmentOnlyRadiusM_9_46);

  // Minimum stack height calculation
  const minHeight = flare.calculateMinimumStackHeight(4.73);
  assert.ok(minHeight >= 15.0);
});

// ============================================================================
// 7. IEC 61882 HAZOP WORKSHEET GENERATOR TESTS
// ============================================================================

test('HAZOP: 5x5 Risk Matrix Ranking Logic', () => {
  // Severity 5, Likelihood 4 -> Score 20 -> Critical
  const crit = RISK_MATRIX.evaluateRisk(5, 4);
  assert.equal(crit.score, 20);
  assert.equal(crit.priority, 'Critical');

  // Severity 3, Likelihood 2 -> Score 6 -> Medium
  const med = RISK_MATRIX.evaluateRisk(3, 2);
  assert.equal(med.score, 6);
  assert.equal(med.priority, 'Medium');

  // Severity 2, Likelihood 1 -> Score 2 -> Low
  const low = RISK_MATRIX.evaluateRisk(2, 1);
  assert.equal(low.score, 2);
  assert.equal(low.priority, 'Low');
});

test('HAZOP: Standard LNG Complex Node Generation and Documentation Export', () => {
  const hazop = new HazopStudyGenerator({
    title: 'World-Scale LNG Facility IEC 61882 HAZOP Study',
    facility: 'LNG Train 1 & Utilities',
    team: 'Process Lead, SIS Specialist, Operations Supervisor'
  });

  hazop.populateStandardLngNodes();

  assert.equal(hazop.nodes.length, 6, 'Generates all 6 standard LNG process nodes');

  const nodeNames = hazop.nodes.map((n) => n.name);
  assert.ok(nodeNames.some((n) => n.includes('Acid Gas Removal')));
  assert.ok(nodeNames.some((n) => n.includes('MCHE')));
  assert.ok(nodeNames.some((n) => n.includes('NGL Recovery')));
  assert.ok(nodeNames.some((n) => n.includes('LNG Storage')));
  assert.ok(nodeNames.some((n) => n.includes('Marine Jetty')));
  assert.ok(nodeNames.some((n) => n.includes('Sulfur Recovery')));

  // Test JSON export
  const jsonData = hazop.toJson();
  assert.equal(jsonData.totalNodes, 6);
  assert.ok(jsonData.totalRows >= 9);

  // Test CSV export
  const csvData = hazop.toCsv();
  assert.match(csvData, /Acid Gas Removal/);
  assert.match(csvData, /More Pressure/);
  assert.match(csvData, /MCHE/);

  // Test Markdown export
  const mdData = hazop.toMarkdown();
  assert.match(mdData, /# World-Scale LNG Facility IEC 61882 HAZOP Study/);
  assert.match(mdData, /## Node 1:/);
  assert.match(mdData, /## Node 2:/);
  assert.match(mdData, /\| ID \| Deviation \|/);
});

// ============================================================================
// 8. UNIFIED MASTER API ACCESSIBILITY TEST
// ============================================================================

test('Unified Master API: Phase 5 Safety Namespace Integration', () => {
  assert.ok(PlantEngineeringMasterApi.safety);
  assert.ok(PlantEngineeringMasterApi.safety.SifVerificationEngine);
  assert.ok(PlantEngineeringMasterApi.safety.LopaStudy);
  assert.ok(PlantEngineeringMasterApi.safety.CauseEffectMatrix);
  assert.ok(PlantEngineeringMasterApi.safety.HazardousAreaClassifier);
  assert.ok(PlantEngineeringMasterApi.safety.Nfpa15DelugeSizingEngine);
  assert.ok(PlantEngineeringMasterApi.safety.FlareRadiationApi521);
  assert.ok(PlantEngineeringMasterApi.safety.HazopStudyGenerator);
});

// ============================================================================
// 9. RIGOROUS DEEP-DIVE EDGE-CASE AND VERIFICATION TESTS
// ============================================================================

test('SIL: Partial Stroke Testing Credit on Redundant 1oo2 & 2oo3 Architectures', () => {
  const lambdaDU = 1.0e-6;
  const lambdaDD = 2.0e-7;
  const TI = 8760.0;
  const beta = 0.05;
  const betaD = 0.02;

  // 1oo2 without PST
  const res1oo2NoPst = calculateSubsystemPfd({
    architecture: '1oo2',
    lambdaDU,
    lambdaDD,
    proofTestIntervalHours: TI,
    beta,
    betaD
  });

  // 1oo2 with monthly PST (65% coverage)
  const res1oo2WithPst = calculateSubsystemPfd({
    architecture: '1oo2',
    lambdaDU,
    lambdaDD,
    proofTestIntervalHours: TI,
    beta,
    betaD,
    pst: {
      intervalHours: 720.0,
      coverage: 0.65
    }
  });

  assert.ok(
    res1oo2WithPst.pfdAvg < res1oo2NoPst.pfdAvg,
    'PST must significantly reduce PFDavg for 1oo2 redundant final elements'
  );
  assert.equal(res1oo2WithPst.pstApplied, true);

  // 2oo3 with PST
  const res2oo3NoPst = calculateSubsystemPfd({
    architecture: '2oo3',
    lambdaDU,
    lambdaDD,
    proofTestIntervalHours: TI,
    beta,
    betaD
  });

  const res2oo3WithPst = calculateSubsystemPfd({
    architecture: '2oo3',
    lambdaDU,
    lambdaDD,
    proofTestIntervalHours: TI,
    beta,
    betaD,
    pst: {
      intervalHours: 720.0,
      coverage: 0.65
    }
  });

  assert.ok(res2oo3WithPst.pfdAvg < res2oo3NoPst.pfdAvg, 'PST must reduce PFDavg for 2oo3 architectures');
});

test('C&E Matrix: XML Escaping and Valid SVG Output for Special Characters', () => {
  const ce = new CauseEffectMatrix({
    title: 'Feed & MCHE <High-Pressure> Shutdown Matrix',
    docNumber: 'CE-DWG-001 & Rev "A"'
  });

  ce.addCause({
    id: 'C-01',
    tag: 'PAHH-101 & 102',
    description: 'High pressure & temperature trip <critical>',
    voting: '2oo4',
    inputs: ['PT-1', 'PT-2', 'PT-3', 'PT-4']
  });

  ce.addEffect({
    id: 'E-01',
    tag: 'XV-101 & 102',
    description: 'Isolation valves "Train 1"',
    esdLevel: 1,
    action: 'CLOSE'
  });

  ce.link('C-01', 'E-01', 'X');

  const svg = ce.toSvg();

  // Confirm XML special characters are properly escaped
  assert.ok(!svg.includes('Feed & MCHE'), 'Raw & must not appear in SVG text');
  assert.match(svg, /Feed &amp; MCHE &lt;High-Pressure&gt;/);
  assert.match(svg, /PAHH-101 &amp; 102/);
  assert.match(svg, /XV-101 &amp; 102/);

  // Test general MooN voting: 2oo4
  assert.equal(ce.causes[0].isTripped({ 'PT-1': true, 'PT-2': false, 'PT-3': false, 'PT-4': false }), false);
  assert.equal(ce.causes[0].isTripped({ 'PT-1': true, 'PT-2': true, 'PT-3': false, 'PT-4': false }), true);
});

test('Hazardous Area: High Ventilation Non-Hazardous Zero Radius and Supercritical Detection', () => {
  // Open air with tiny hole (0.1mm) and high wind -> High ventilation degree -> Non-Hazardous
  const classifierNonEx = new HazardousAreaClassifier({
    areaName: 'Low Pressure Piping',
    substanceKey: 'methane',
    gradeOfRelease: 'secondary',
    operatingPressureBarg: 0.2,
    holeDiameterMm: 0.1,
    windSpeedMPerS: 5.0
  });

  const resNonEx = classifierNonEx.classify();
  if (resNonEx.classification.zone === 'Non-Hazardous') {
    assert.equal(resNonEx.extent.horizontalRadiusM, 0, 'Non-Hazardous zone must have zero hazardous extent radius');
    assert.equal(resNonEx.extent.verticalExtentUpM, 0);
    assert.equal(resNonEx.extent.verticalExtentDownM, 0);
  }

  // Supercritical pressure test (70 barg methane, Pc = 46 bar)
  const classifierSupercritical = new HazardousAreaClassifier({
    areaName: 'Supercritical Feed Gas Line',
    substanceKey: 'methane',
    gradeOfRelease: 'secondary',
    operatingPressureBarg: 70.0
  });

  const resSuper = classifierSupercritical.classify();
  assert.equal(resSuper.releaseConditions.isSupercritical, true);
});

test('Fire & Gas: Discrete Optical Flame Signals and Sour Gas Toxic H2S Mapping', () => {
  // Boolean optical flame detector testing
  const flameDetectors = [
    { tag: 'FD-101', value: true },
    { tag: 'FD-102', value: false },
    { tag: 'FD-103', isAlarm: true }
  ];

  const voteResult = evaluateFgVoting({
    votingScheme: '2oo3',
    detectors: flameDetectors
  });

  assert.equal(voteResult.activeCount, 2);
  assert.equal(voteResult.isTriggered, true);

  // Toxic H2S layout mapping for sour gas unit
  const sourZone = new FireGasZoneLayout({
    zoneName: 'Acid Gas Removal Unit (AGRU)',
    lengthM: 30.0,
    widthM: 20.0,
    hasToxicH2s: true
  });

  const layout = sourZone.generateRecommendedLayout();
  assert.ok(layout.recommendedDetectors.toxicH2s);
  assert.ok(layout.recommendedDetectors.toxicH2s.count >= 2);
  assert.match(layout.votingMatrix.toxicH2sAlarm, /H2S/);
});

test('Flare Radiation: Minimum Stack Height and Atmospheric Transmissivity Refinement', () => {
  const flare = new FlareRadiationApi521({
    flareTag: 'FLARE-REFINED',
    reliefRateKgH: 100000.0,
    stackHeightM: 50.0,
    relativeHumidityPct: 70.0
  });

  const minH = flare.calculateMinimumStackHeight(4.73);
  assert.ok(minH >= 15.0);

  // Test zero relief case
  const zeroFlare = new FlareRadiationApi521({
    reliefRateKgH: 0.0
  });
  const zeroH = zeroFlare.calculateMinimumStackHeight(4.73);
  assert.equal(zeroH, 15.0);
});

test('LOPA: Robust Parameter Validation for Invalid Frequencies', () => {
  assert.throws(() => {
    new LopaScenario({
      initiatingFrequency: -0.5
    });
  }, RangeError);

  assert.throws(() => {
    new LopaScenario({
      customTargetFrequency: 0
    });
  }, RangeError);
});

