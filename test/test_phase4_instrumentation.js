'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PlantEngineeringMasterApi,
  OrificeIso5167,
  FlowmeterSelection,
  LevelPressureTemperature,
  InstrumentIndexModule,
  LoopDiagramIld,
  ControlNarrative
} = require('../src/core/plant/plant_engineering_master_api');

// ============================================================================
// 1. ISO 5167 ORIFICE, NOZZLE & VENTURI FLOW ELEMENTS
// ============================================================================

test('ISO 5167-2: Reader-Harris/Gallagher (R-H/G) Discharge Coefficient & Tap Types', () => {
  const D = 0.100; // 100 mm pipe ID
  const beta = 0.50; // d = 50 mm
  const ReD = 2.0e5; // Reynolds number

  // Flange taps
  const cdFlange = OrificeIso5167.calculateOrificeCd({
    beta,
    D,
    ReD,
    tapType: OrificeIso5167.TAP_TYPES.FLANGE
  });

  // Typical R-H/G Cd for beta=0.5, ReD=2e5 is between 0.603 and 0.608
  assert.ok(cdFlange > 0.600 && cdFlange < 0.615, `Cd flange (${cdFlange}) should be ~0.606`);

  // Corner taps
  const cdCorner = OrificeIso5167.calculateOrificeCd({
    beta,
    D,
    ReD,
    tapType: OrificeIso5167.TAP_TYPES.CORNER
  });
  assert.ok(cdCorner > 0.595 && cdCorner < 0.615, `Cd corner (${cdCorner}) should be within physical range`);

  // D and D/2 taps
  const cdRadius = OrificeIso5167.calculateOrificeCd({
    beta,
    D,
    ReD,
    tapType: OrificeIso5167.TAP_TYPES.D_AND_D_OVER_2
  });
  assert.ok(cdRadius > 0.595 && cdRadius < 0.615, `Cd D-D/2 (${cdRadius}) should be within physical range`);

  // Small bore pipe correction check (D < 71.12 mm)
  const dSmall = 0.050; // 50 mm pipe
  const cdSmall = OrificeIso5167.calculateOrificeCd({
    beta: 0.5,
    D: dSmall,
    ReD: 1.0e5,
    tapType: OrificeIso5167.TAP_TYPES.FLANGE
  });
  assert.ok(cdSmall > 0.600, 'Small pipe correction should be evaluated');
});

test('ISO 5167: Expansibility Factor Epsilon and Permanent Pressure Loss', () => {
  // Incompressible liquid: epsilon must be strictly 1.0
  const epsLiquid = OrificeIso5167.calculateExpansibility({
    beta: 0.5,
    P1: 2.0e6,
    deltaP: 50.0e3,
    isGas: false
  });
  assert.equal(epsLiquid, 1.0);

  // Compressible gas: epsilon must be < 1.0
  const epsGas = OrificeIso5167.calculateExpansibility({
    beta: 0.5,
    P1: 2.0e6,
    deltaP: 50.0e3,
    isentropicExponent: 1.30, // Natural gas
    isGas: true,
    deviceType: OrificeIso5167.DEVICE_TYPES.ORIFICE_PLATE
  });
  assert.ok(epsGas < 1.0 && epsGas > 0.95, `Eps gas (${epsGas}) should be between 0.95 and 1.0`);

  // Zero deltaP edge case: expansibility must return strictly 1.0 (no NaN singularity)
  const epsZeroNozzle = OrificeIso5167.calculateExpansibility({
    beta: 0.5,
    P1: 1.0e5,
    deltaP: 0,
    isentropicExponent: 1.40,
    isGas: true,
    deviceType: OrificeIso5167.DEVICE_TYPES.ISA_1932_NOZZLE
  });
  assert.equal(epsZeroNozzle, 1.0);

  // Permanent pressure loss
  const loss = OrificeIso5167.calculatePermanentPressureLoss({
    deltaP: 50000,
    beta: 0.5,
    Cd: 0.605,
    deviceType: OrificeIso5167.DEVICE_TYPES.ORIFICE_PLATE
  });
  // For beta = 0.5, permanent pressure loss across orifice is typically ~70% of deltaP
  assert.ok(loss.lossPercentage > 65.0 && loss.lossPercentage < 78.0, `Loss % (${loss.lossPercentage}) should be ~72%`);
});

test('ISO 5167-2: Bore Sizing Iterative Solver and Forward Flow Verification', () => {
  const pipeDiameterM = 0.15408; // 6-inch Sch 40 pipe (ID = 154.08 mm)
  const targetFlowKgS = 25.0; // 90 tonnes/h
  const targetDeltaP = 25000.0; // 25 kPa (250 mbar)
  const rho = 800.0; // Light hydrocarbon liquid (800 kg/m3)
  const mu = 0.0005; // 0.5 cP

  // Solve for bore diameter d
  const sizing = OrificeIso5167.sizeBoreDiameter({
    qm: targetFlowKgS,
    targetDeltaP,
    D: pipeDiameterM,
    rho1: rho,
    mu,
    tapType: OrificeIso5167.TAP_TYPES.FLANGE,
    isGas: false
  });

  assert.ok(sizing.boreDiameterMm > 50 && sizing.boreDiameterMm < 130);
  assert.ok(sizing.beta > 0.35 && sizing.beta < 0.75);
  // Verification: calculated mass flow must match target flow to within 1e-6 relative error
  assert.ok(sizing.relativeFlowError < 1e-6, `Relative error (${sizing.relativeFlowError}) must be < 1e-6`);

  // Forward check with calculated d
  const forward = OrificeIso5167.calculateFlowRate({
    d: sizing.boreDiameterM,
    D: pipeDiameterM,
    deltaP: targetDeltaP,
    rho1: rho,
    mu,
    tapType: OrificeIso5167.TAP_TYPES.FLANGE,
    isGas: false
  });
  assert.ok(Math.abs(forward.massFlowRateKgS - targetFlowKgS) < 1e-5);
  assert.equal(forward.standardLimits.isWithinStandard, true);

  // Unfeasible tiny flow: should reject with informative error rather than unbracketed divergence
  assert.throws(() => {
    OrificeIso5167.sizeBoreDiameter({
      qm: 0.00001, // 0.01 g/s in DN150
      targetDeltaP: 50000.0,
      D: pipeDiameterM,
      rho1: rho,
      mu
    });
  }, /too small/i);
});

test('ISO 5167-3/4: ISA 1932 Nozzle and Venturi Tube Calculations', () => {
  const D = 0.200;
  const beta = 0.60;
  const ReD = 5.0e5;

  const cdNozzle = OrificeIso5167.calculateDeviceCd({
    deviceType: OrificeIso5167.DEVICE_TYPES.ISA_1932_NOZZLE,
    beta,
    ReD
  });
  // ISA 1932 nozzle Cd is typically ~0.96 to 0.98
  assert.ok(cdNozzle > 0.95 && cdNozzle < 0.99, `Nozzle Cd (${cdNozzle}) should be ~0.965`);

  const cdVenturi = OrificeIso5167.calculateDeviceCd({
    deviceType: OrificeIso5167.DEVICE_TYPES.VENTURI_MACHINED,
    beta,
    ReD
  });
  assert.equal(cdVenturi, 0.995);

  const venturiLoss = OrificeIso5167.calculatePermanentPressureLoss({
    deltaP: 40000,
    beta,
    Cd: cdVenturi,
    deviceType: OrificeIso5167.DEVICE_TYPES.VENTURI_MACHINED
  });
  // Venturi permanent loss is ~12-15%, much lower than orifice (~70%)
  assert.ok(venturiLoss.lossPercentage <= 16.0);
  assert.ok(venturiLoss.lossPercentage >= 8.0);
});

// ============================================================================
// 2. INDUSTRIAL FLOWMETER SELECTION & SIZING ENGINE
// ============================================================================

test('Flowmeter Sizing: Coriolis Mass Flowmeter on Cryogenic LNG', () => {
  const result = FlowmeterSelection.sizeCoriolisMeter({
    massFlowKgH: 180000, // 180 t/h LNG rundown
    densityKgM3: 450.0, // Cryogenic LNG density
    viscosityCp: 0.12,
    lineSizeMm: 150
  });

  assert.equal(result.technology, FlowmeterSelection.FLOWMETER_TECHNOLOGIES.CORIOLIS);
  assert.ok(['DN100', 'DN150', 'DN200'].includes(result.selectedSize));
  assert.ok(result.tubeVelocityMS > 1.0 && result.tubeVelocityMS < 8.0);
  assert.ok(result.pressureDropBar < 1.5, `Pressure drop (${result.pressureDropBar} bar) should be reasonable`);
  assert.ok(result.totalUncertaintyPercent <= 0.20, 'Coriolis total uncertainty should be <= 0.2%');
  assert.equal(result.straightRunRequiredUpstreamD, 0);
});

test('Flowmeter Sizing: Ultrasonic Multipath AGA Report No. 9 Custody Gas Meter', () => {
  const result = FlowmeterSelection.sizeUltrasonicMultipath({
    pipeDiameterMm: 300, // 12-inch pipe
    volumeFlowM3H: 3500, // 3500 m3/h gives ~13.7 m/s (ideal AGA 9 range: 0.3 to 30 m/s)
    operatingPressureBar: 65.0,
    operatingTempC: 25.0,
    gasDensityKgM3: 48.5,
    speedOfSoundMS: 410.0,
    pathConfiguration: 4
  });

  assert.equal(result.technology, FlowmeterSelection.FLOWMETER_TECHNOLOGIES.ULTRASONIC_MULTIPATH);
  assert.equal(result.chordalPaths.length, 4);
  assert.equal(result.velocityStatus, 'OK');
  assert.equal(result.sosSpreadStatus, 'NORMAL');
  assert.equal(result.custodyTransferApproved, true);
  assert.ok(result.meanVelocityMS >= 0.3 && result.meanVelocityMS <= 30.0);
  assert.ok(result.pressureDropBar < 0.05, 'Ultrasonic meter has negligible pressure loss');
});

test('Flowmeter Sizing: Vortex Shedding and Reynolds Number Constraint', () => {
  // Case A: High Reynolds number (turbulent flow) -> Valid
  const validVortex = FlowmeterSelection.sizeVortexMeter({
    pipeDiameterMm: 100,
    volumeFlowM3H: 80.0,
    densityKgM3: 1000.0,
    viscosityCp: 1.0,
    fluidPhase: FlowmeterSelection.FLUID_PHASES.LIQUID
  });
  assert.equal(validVortex.isReynoldsSufficient, true);
  assert.ok(validVortex.reynoldsNumber > 20000);
  assert.ok(validVortex.sheddingFrequencyHz > 10.0);
  assert.ok(validVortex.bluffBodyVelocityMS > validVortex.velocityMS, 'Bluff body throat velocity must exceed approach velocity');
  assert.equal(validVortex.blockageRatio, 0.28);
  assert.equal(validVortex.feasibilityStatus, 'FEASIBLE');

  // Case B: Very low flow / high viscosity -> Re < 20,000 -> Infeasible
  const laminarVortex = FlowmeterSelection.sizeVortexMeter({
    pipeDiameterMm: 100,
    volumeFlowM3H: 1.0,
    densityKgM3: 950.0,
    viscosityCp: 15.0, // High viscosity oil
    fluidPhase: FlowmeterSelection.FLUID_PHASES.LIQUID
  });
  assert.equal(laminarVortex.isReynoldsSufficient, false);
  assert.equal(laminarVortex.feasibilityStatus, 'INSUFFICIENT_REYNOLDS');
});

test('Flowmeter Sizing: Electromagnetic Meter Conductivity Constraint', () => {
  // Case A: Cooling water (conductive, sigma = 350 uS/cm) -> Feasible
  const waterMag = FlowmeterSelection.sizeElectromagneticMeter({
    pipeDiameterMm: 200,
    volumeFlowM3H: 300,
    conductivityUSCm: 350.0
  });
  assert.equal(waterMag.isConductivitySufficient, true);
  assert.equal(waterMag.warnings.length, 0);

  // Case B: Hydrocarbon / LNG (non-conductive, sigma ~ 0) -> Infeasible
  const hydrocarbonMag = FlowmeterSelection.sizeElectromagneticMeter({
    pipeDiameterMm: 200,
    volumeFlowM3H: 300,
    conductivityUSCm: 0.001
  });
  assert.equal(hydrocarbonMag.isConductivitySufficient, false);
  assert.ok(hydrocarbonMag.warnings.length > 0);
});

test('Master Selection Engine: Automated Evaluation on LNG vs Water', () => {
  // 1. LNG Custody Transfer -> Should recommend Coriolis or Ultrasonic
  const lngSelection = FlowmeterSelection.selectFlowmeter({
    fluidPhase: FlowmeterSelection.FLUID_PHASES.LIQUID,
    fluidName: 'LNG Product',
    massFlowKgH: 250000,
    densityKgM3: 450.0,
    viscosityCp: 0.15,
    conductivityUSCm: 0.0,
    pipeDiameterMm: 200,
    isCustodyTransfer: true,
    allowableDeltaPBar: 0.8
  });
  assert.equal(lngSelection.recommendedTechnology, FlowmeterSelection.FLOWMETER_TECHNOLOGIES.CORIOLIS);

  // 2. Cooling Water -> Magmeter should be top ranked due to zero delta P and low cost
  const waterSelection = FlowmeterSelection.selectFlowmeter({
    fluidPhase: FlowmeterSelection.FLUID_PHASES.LIQUID,
    fluidName: 'Seawater Cooling Return',
    volumeFlowM3H: 500,
    densityKgM3: 1025.0,
    viscosityCp: 1.05,
    conductivityUSCm: 45000.0, // Highly conductive seawater
    pipeDiameterMm: 250,
    allowableDeltaPBar: 0.2
  });
  assert.equal(waterSelection.recommendedTechnology, FlowmeterSelection.FLOWMETER_TECHNOLOGIES.ELECTROMAGNETIC);
});

// ============================================================================
// 3. LEVEL, PRESSURE & TEMPERATURE TRANSMITTER ENGINEERING
// ============================================================================

test('DP Level Transmitter Calibration: Dry-Leg vs Wet-Leg Zero & Span', () => {
  const hSpanMm = 2000.0; // 2 m span
  const hMinMm = 200.0;
  const rhoProc = 900.0; // Hydrocarbon liquid
  const rhoVap = 15.0; // High pressure vapor

  // 1. Dry Leg Calibration
  const dry = LevelPressureTemperature.calibrateDryLeg({
    hSpanMm,
    hMinMm,
    processDensityKgM3: rhoProc,
    vaporDensityKgM3: rhoVap
  });
  assert.ok(dry.lrvPa > 0, 'Dry leg has positive zero suppression');
  assert.ok(dry.urvPa > dry.lrvPa);
  assert.ok(Math.abs(dry.spanMmH2O - (rhoProc - rhoVap) * 2000.0 / 1000.0 * (1000 / 1000)) < 50);

  // 2. Wet Leg Calibration (Condensing steam drum or cryo vessel)
  const wet = LevelPressureTemperature.calibrateWetLeg({
    hSpanMm,
    hMinMm,
    tapDistanceMm: 2500.0,
    processDensityKgM3: rhoProc,
    fillFluidDensityKgM3: 1000.0, // Water/glycol wet leg
    vaporDensityKgM3: rhoVap
  });
  assert.ok(wet.lrvPa < 0, 'Wet leg should exhibit negative LRV (zero elevation)');
  assert.ok(wet.zeroElevation, 'zeroElevation flag must be true');
  assert.ok(wet.spanPa > 0, 'Span must be strictly positive');
  assert.equal(wet.spanPa, (rhoProc - rhoVap) * LevelPressureTemperature.GRAVITY * (hSpanMm / 1000.0));
});

test('Interface Level Calibration: Immiscible Hydrocarbon/Aqueous Phases', () => {
  const result = LevelPressureTemperature.calibrateInterfaceLevel({
    hSpanMm: 1500.0,
    tapDistanceMm: 1800.0,
    heavyDensityKgM3: 1040.0, // Rich amine solution
    lightDensityKgM3: 650.0 // Condensed liquid hydrocarbons
  });

  assert.equal(result.method, 'interface_level');
  assert.equal(result.densityDifferenceKgM3, 390.0);
  assert.ok(result.spanPa > 0);
  assert.equal(result.lrvPa, 0);
});

test('Radar Level Evaluation: Dielectric Reflection and GWR Selection', () => {
  // Low dielectric LNG (er = 1.7) -> Should recommend Guided Wave Radar with coaxial probe
  const lngRadar = LevelPressureTemperature.evaluateRadarLevel({
    dielectricConstant: 1.7,
    vesselHeightM: 10.0,
    isCryogenic: true
  });
  assert.equal(lngRadar.recommendedTechnology, 'GUIDED_WAVE_RADAR');
  assert.equal(lngRadar.probeOrAntennaType, 'COAXIAL_PROBE');
  assert.ok(lngRadar.reflectionCoefficient > 0 && lngRadar.reflectionCoefficient < 0.2);

  // High dielectric Water (er = 80.0) -> Non-contact 80 GHz FMCW
  const waterRadar = LevelPressureTemperature.evaluateRadarLevel({
    dielectricConstant: 80.0,
    vesselHeightM: 6.0
  });
  assert.equal(waterRadar.recommendedTechnology, 'NON_CONTACT_80GHZ_FMCW');
  assert.ok(waterRadar.reflectedPowerPercent > 60.0);
});

test('Pressure Transmitter Sizing & Range Selection', () => {
  const tx = LevelPressureTemperature.sizePressureTransmitter({
    operatingPressureBarg: 42.0,
    designPressureBarg: 65.0,
    processTempC: 35.0,
    isDifferential: true
  });

  assert.ok(tx.selectedUrlBarg >= 42.0);
  assert.equal(tx.selectedUrlBarg, 100.0); // Next standard URL above 42 / 0.65 = 64.6 is 100 bar
  assert.equal(tx.manifoldType, '5_VALVE_MANIFOLD');
  assert.ok(tx.proofPressureBarg >= 1.5 * 65.0);
  assert.equal(tx.requiresDiaphragmSeal, false);
});

test('ASME PTC 19.3 TW-2016 Thermowell Wake-Frequency & Mechanical Stress', () => {
  // Case A: Safe design with proper immersion length
  const safeWell = LevelPressureTemperature.checkThermowellAsmePtc19_3({
    lengthMm: 180.0, // 180 mm immersion
    rootDiameterMm: 24.0,
    tipDiameterMm: 18.0,
    boreDiameterMm: 6.6,
    materialKey: 'SS316L',
    fluidVelocityMS: 4.5,
    fluidDensityKgM3: 45.0, // High pressure natural gas
    fluidPressureBarg: 50.0,
    fluidTempC: 25.0
  });

  assert.equal(safeWell.standardReference, 'ASME PTC 19.3 TW-2016');
  assert.ok(safeWell.sheddingFrequencyHz > 0);
  assert.ok(safeWell.naturalFrequencyInFluidHz > safeWell.sheddingFrequencyHz);
  assert.ok(safeWell.transverseFrequencyRatio < 0.8, 'Transverse ratio must be < 0.8');
  assert.ok(safeWell.inlineFrequencyRatio < 0.4, 'Inline ratio fs/fn must be < 0.4');
  assert.ok(safeWell.tipStressMpa > 0, 'Tip stress must be evaluated');
  assert.equal(safeWell.passesTipStressCheck, true, 'Tip stress must satisfy allowable');
  assert.equal(safeWell.passesTransverseResonance, true);
  assert.equal(safeWell.passesInlineResonance, true);
  assert.equal(safeWell.passesStressCheck, true);
  assert.equal(safeWell.isCompliant, true);

  // Case B: Excessively long thermowell in high velocity crossflow -> Resonance failure
  const failingWell = LevelPressureTemperature.checkThermowellAsmePtc19_3({
    lengthMm: 600.0, // 600 mm slender cantilever
    rootDiameterMm: 20.0,
    tipDiameterMm: 14.0,
    boreDiameterMm: 6.6,
    materialKey: 'SS316L',
    fluidVelocityMS: 18.0, // Severe velocity
    fluidDensityKgM3: 850.0, // Dense liquid
    fluidPressureBarg: 80.0
  });

  assert.equal(failingWell.isCompliant, false);
  assert.ok(failingWell.failureReasons.length > 0);
});

test('Temperature Sensor Selection & IEC 60751 Callendar-Van Dusen Pt100', () => {
  // Resistance at 0 degC must be exactly 100.00 Ohm
  const r0 = LevelPressureTemperature.pt100ResistanceFromTemp(0.0);
  assert.ok(Math.abs(r0 - 100.00) < 1e-4);

  // Resistance at 100 degC is 138.51 Ohm
  const r100 = LevelPressureTemperature.pt100ResistanceFromTemp(100.0);
  assert.ok(Math.abs(r100 - 138.51) < 0.05);

  // Resistance at -161.5 degC (boiling LNG) is ~35.0 Ohm
  const rLng = LevelPressureTemperature.pt100ResistanceFromTemp(-161.5);
  assert.ok(rLng > 30.0 && rLng < 40.0, `R at -161.5C (${rLng}) should be ~35 Ohm`);

  // Sensor selection for cryogenic LNG (Pt100 or Type T)
  const sensor = LevelPressureTemperature.selectTemperatureSensor({
    minTempC: -170.0,
    maxTempC: 30.0,
    accuracyRequiredC: 0.5,
    isCryogenic: true
  });
  assert.ok(sensor.recommendedSensor.includes('PT100') || sensor.recommendedSensor.includes('TYPE_T'));

  // Sensor selection for reducing atmosphere (Type J)
  const sensorJ = LevelPressureTemperature.selectTemperatureSensor({
    minTempC: 20.0,
    maxTempC: 450.0,
    atmosphere: 'reducing'
  });
  assert.equal(sensorJ.recommendedSensor, 'THERMOCOUPLE_TYPE_J');

  // Sensor selection requiring high EMF output (Type E)
  const sensorE = LevelPressureTemperature.selectTemperatureSensor({
    minTempC: -50.0,
    maxTempC: 300.0,
    requiresHighEmf: true
  });
  assert.equal(sensorE.recommendedSensor, 'THERMOCOUPLE_TYPE_E');
});

// ============================================================================
// 4. ISA-5.1 INSTRUMENT INDEX & DCS/SIS I/O SCHEDULE (20% SPARE RULE)
// ============================================================================

test('ISA-5.1 Tag Parsing and Functional Classification', () => {
  const p1 = InstrumentIndexModule.parseIsaTag('10-FT-1001A');
  assert.equal(p1.area, '10');
  assert.equal(p1.variable, 'F');
  assert.equal(p1.functionCode, 'T');
  assert.equal(p1.loopNumber, '1001');
  assert.equal(p1.suffix, 'A');

  const c1 = InstrumentIndexModule.classifyTagLetters('FT');
  assert.equal(c1.signalType, 'AI');
  assert.equal(c1.system, 'BPCS');

  const c2 = InstrumentIndexModule.classifyTagLetters('ESDV');
  assert.equal(c2.signalType, 'DO');
  assert.equal(c2.system, 'SIS');
});

test('Instrument Index: Auto-Allocation and 20% Installed Spare Capacity Enforcement', () => {
  const index = new InstrumentIndexModule.InstrumentIndex({
    projectName: 'LNG Phase 4 Test Complex'
  });

  // Add 10 Analog Inputs
  for (let i = 1; i <= 10; i++) {
    index.addInstrument({
      tag: `10-PT-100${i}`,
      signalType: 'AI',
      system: 'BPCS',
      serviceDescription: `Pump ${i} Suction Pressure`
    });
  }

  // Add 4 Discrete Outputs (SIS solenoids)
  for (let i = 1; i <= 4; i++) {
    index.addInstrument({
      tag: `10-XV-200${i}`,
      signalType: 'DO',
      system: 'SIS',
      serviceDescription: `Shutdown Valve ${i} Solenoid`
    });
  }

  const schedule = index.allocateIoChannels();

  // For 10 used AI channels (card capacity 16):
  // 10 * 1.20 = 12 channels required with 20% spare -> 1 card installed (16 channels total)
  // Spares = 16 - 10 = 6 spare channels (60% spare achieved)
  const aiSchedule = schedule['BPCS_AI'];
  assert.equal(aiSchedule.usedChannels, 10);
  assert.equal(aiSchedule.cardsInstalled, 1);
  assert.equal(aiSchedule.totalInstalledChannels, 16);
  assert.equal(aiSchedule.installedSpareChannels, 6);
  assert.ok(aiSchedule.sparePercentageAchieved >= 20.0);

  // Check rack/slot/channel allocation
  const firstItem = index.items[0];
  assert.ok(firstItem.rackSlotChannel.includes('RACK-01/SLOT-01/CH-01'));

  // Verify I/O summary
  const summary = index.getIoSummary();
  assert.equal(summary.totalActiveIoChannels, 14);
  assert.ok(summary.totalInstalledChannels >= Math.ceil(14 * 1.20));

  // CSV output check
  const csv = index.toCsv();
  assert.ok(csv.includes('10-PT-1001'));
  assert.ok(csv.includes('RACK-01'));
});

test('World-Scale LNG Complex Instrument Index Factory Verification', () => {
  const index = InstrumentIndexModule.createWorldScaleLngInstrumentIndex();
  assert.ok(index.items.length >= 30, `Index should have >= 30 instruments, got ${index.items.length}`);

  const summary = index.getIoSummary();
  assert.ok(summary.totalActiveIoChannels >= 25);
  assert.ok(summary.totalInstalledChannels > summary.totalActiveIoChannels);

  // Verify presence of critical tags
  const tags = index.items.map((i) => i.tag);
  assert.ok(tags.includes('10-FT-1001A'));
  assert.ok(tags.includes('10-ESDV-1001'));
  assert.ok(tags.includes('40-FT-4001'));
  assert.ok(tags.includes('40-BDV-4001'));
  assert.ok(tags.includes('50-LSHH-5001A'));

  const jsonExport = index.toJson();
  assert.equal(jsonExport.projectName, 'World-Scale LNG Engineering Complex');
  assert.equal(jsonExport.instruments.length, index.items.length);
});

test('InstrumentIndex: Auto-Generation from P&ID and Plant Unit Specifications', () => {
  const pidSpec = {
    projectName: 'LNG Pretreatment Train',
    unitName: 'Acid Gas Removal Unit',
    area: '10',
    pandidNumber: 'PID-10-001',
    equipment: [
      { tag: '10-V-101', name: 'Feed Slug Catcher', type: 'separator' },
      { tag: '10-P-101', name: 'Lean Amine Booster Pump', type: 'pump' },
      { tag: '10-C-101', name: 'Acid Gas Absorber', type: 'column' },
      { tag: '10-E-101', name: 'Lean/Rich Exchanger', type: 'exchanger' }
    ],
    lines: [
      { lineTag: '10-PL-101', service: 'Feed Gas Trunkline', isSafety: true },
      { lineTag: '10-PL-102', service: 'Treated Gas Run-Down' }
    ]
  };

  const pidIndex = InstrumentIndexModule.generateInstrumentIndexFromPid(pidSpec);
  assert.ok(pidIndex.items.length >= 10, 'Should synthesize instruments for all equipment and safety lines');

  // Verify separator instruments
  const separatorTags = pidIndex.items.filter((i) => i.lineOrEquipment === '10-V-101').map((i) => i.tag);
  assert.ok(separatorTags.some((t) => t.includes('LIT')), 'Separator should have level radar LIT');
  assert.ok(separatorTags.some((t) => t.includes('LSHH')), 'Separator should have safety trip LSHH');
  assert.ok(separatorTags.some((t) => t.includes('LV')), 'Separator should have level control valve LV');
  assert.ok(separatorTags.some((t) => t.includes('BDV')), 'Separator should have blowdown valve BDV');

  // Verify pump instruments
  const pumpTags = pidIndex.items.filter((i) => i.lineOrEquipment === '10-P-101').map((i) => i.tag);
  assert.ok(pumpTags.some((t) => t.includes('FT')), 'Pump should have flowmeter FT');
  assert.ok(pumpTags.some((t) => t.includes('FV')), 'Pump should have spillback valve FV');

  // Verify line instruments
  const lineTags = pidIndex.items.filter((i) => i.lineOrEquipment === '10-PL-101').map((i) => i.tag);
  assert.ok(lineTags.some((t) => t.includes('ESDV')), 'Safety line should have ESDV');
  assert.ok(lineTags.some((t) => t.includes('ZSO')), 'Safety line should have limit switch ZSO');

  // Test multi-P&ID plant unit generator
  const unitSpec = {
    projectName: 'LNG Liquefaction Complex',
    unitName: 'Full Plant Synthesis',
    pids: [
      pidSpec,
      {
        area: '40',
        pandidNumber: 'PID-40-001',
        equipment: [{ tag: '40-K-101', name: 'Mixed Refrigerant Compressor', type: 'compressor' }]
      }
    ]
  };
  const unitIndex = InstrumentIndexModule.generateInstrumentIndexFromPlantUnit(unitSpec);
  assert.ok(unitIndex.items.length > pidIndex.items.length);
  const compressorTags = unitIndex.items.filter((i) => i.lineOrEquipment === '40-K-101').map((i) => i.tag);
  assert.ok(compressorTags.some((t) => t.includes('FV')), 'Compressor should have anti-surge valve FV');

  const summary = unitIndex.getIoSummary();
  assert.ok(summary.totalInstalledChannels >= Math.ceil(summary.totalActiveIoChannels * 1.20));
});

// ============================================================================
// 5. ISA-5.4 INSTRUMENT LOOP DIAGRAM (ILD) GENERATOR
// ============================================================================

test('ISA-5.4 Loop Diagram: 4-Zone Structured JSON Model', () => {
  const loop = LoopDiagramIld.createAnalogInputLoop({
    loopTag: '10-FL-1001',
    primaryTag: '10-FT-1001',
    serviceDescription: 'Feed Gas Flow to Acid Gas Absorber'
  });

  const json = loop.toJson();
  assert.equal(json.loopTag, '10-FL-1001');
  assert.equal(json.primaryTag, '10-FT-1001');

  // Verify 4 zones
  assert.ok(json.zones.zone1_field);
  assert.ok(json.zones.zone2_junctionBox);
  assert.ok(json.zones.zone3_marshalling);
  assert.ok(json.zones.zone4_systemCabinet);

  assert.equal(json.zones.zone1_field.outputSignal, '4-20mA HART');
  assert.equal(json.zones.zone2_junctionBox.tag, '10-JB-01');
  assert.ok(json.zones.zone3_marshalling.barrierTag.includes('ISO'));
  assert.ok(json.zones.zone4_systemCabinet.controllerTag.includes('FIC'));
});

test('ISA-5.4 Loop Diagram: Vector SVG Generation & Engineering Elements', () => {
  const loop = LoopDiagramIld.createAnalogInputLoop({
    loopTag: '40-PL-4001',
    primaryTag: '40-PT-4001',
    serviceDescription: 'MCHE High Pressure Feed Gas Inlet Pressure'
  });

  const svg = loop.toSvg();

  // Basic SVG structure checks
  assert.ok(svg.startsWith('<?xml version="1.0"'));
  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('</svg>'));

  // Check 4-zone header titles in SVG
  assert.ok(svg.includes('ZONE 1: FIELD AREA'));
  assert.ok(svg.includes('ZONE 2: JUNCTION BOX'));
  assert.ok(svg.includes('ZONE 3: MARSHALLING'));
  assert.ok(svg.includes('ZONE 4: SYSTEM CABINET'));

  // Check title block content
  assert.ok(svg.includes('40-PL-4001'));
  assert.ok(svg.includes('MCHE High Pressure Feed Gas'));
  assert.ok(svg.includes('ENGINEERING NOTES:'));
  assert.ok(svg.includes('IS BARRIER'));
});

test('ISA-5.4 Loop Diagram: Factory for AO Control Valve and DO Shutdown Solenoid', () => {
  // AO Valve Loop
  const aoLoop = LoopDiagramIld.createAnalogOutputLoop({
    loopTag: '10-FL-1201',
    primaryTag: '10-FV-1201',
    serviceDescription: 'Lean Amine Flow Control Valve'
  });
  const aoJson = aoLoop.toJson();
  assert.equal(aoJson.loopType, 'ANALOG_OUTPUT_4_20MA');
  assert.ok(aoJson.zones.zone1_field.deviceType.includes('Control Valve'));

  // DO Shutdown Valve Loop (SIS)
  const doLoop = LoopDiagramIld.createDigitalOutputLoop({
    loopTag: '10-ESD-1001',
    primaryTag: '10-ESDV-1001',
    serviceDescription: 'Feed Gas Emergency Shutdown Valve'
  });
  const doJson = doLoop.toJson();
  assert.equal(doJson.loopType, 'DIGITAL_OUTPUT_SIS');
  assert.equal(doJson.system, 'SIS');
  assert.ok(doJson.zones.zone1_field.deviceType.includes('Solenoid'));
});

test('ISA-5.4 Loop Diagram: Tag Bubble Parsing & Vector SVG Rendering for Two-Part Tags', () => {
  // Test standalone tag bubble parser
  const twoPart = LoopDiagramIld.extractTagBubbleParts('FV-1201');
  assert.equal(twoPart.letters, 'FV');
  assert.equal(twoPart.loopNumber, '1201');

  const threePart = LoopDiagramIld.extractTagBubbleParts('10-FT-1001');
  assert.equal(threePart.letters, 'FT');
  assert.equal(threePart.loopNumber, '1001');

  const unhyphenated = LoopDiagramIld.extractTagBubbleParts('PT201');
  assert.equal(unhyphenated.letters, 'PT');
  assert.equal(unhyphenated.loopNumber, '201');

  // Verify vector SVG rendering renders both letters and loop number cleanly
  const loop = LoopDiagramIld.createAnalogOutputLoop({
    loopTag: 'FV-1201',
    primaryTag: 'FV-1201',
    serviceDescription: 'Amine Reboiler Control Valve'
  });
  const svg = loop.toSvg();
  assert.ok(svg.includes('>FV<'), 'SVG must include tag letters text node FV');
  assert.ok(svg.includes('>1201<'), 'SVG must include loop number text node 1201');
  assert.ok(!svg.includes('>1001<'), 'SVG must not contain hardcoded default number 1001 for FV-1201');
  assert.ok(svg.includes('AO Driver'), 'SVG marshalling barrier must show AO Driver for analog output');
  assert.ok(svg.includes('Cable Tray'), 'SVG must render cable tray routing between JB and Marshalling');
});

// ============================================================================
// 6. PROCESS CONTROL & SAFEGUARDING NARRATIVE GENERATOR
// ============================================================================

test('Control Narrative: Regulatory, Cascade, Anti-Surge & Trip Interlocks', () => {
  const narrative = ControlNarrative.createWorldScaleLngControlNarratives();
  assert.ok(narrative.regulatoryLoops.length >= 4);
  assert.ok(narrative.advancedStrategies.length >= 5);
  assert.ok(narrative.safeguardingInterlocks.length >= 4);

  // Check Cascade Strategy
  const cascade = narrative.advancedStrategies.find((s) => s.type === ControlNarrative.CONTROL_TYPES.CASCADE);
  assert.ok(cascade);
  assert.ok(cascade.primaryController.includes('TIC'));
  assert.ok(cascade.secondaryController.includes('FIC'));

  // Check Anti-Surge Strategy
  const antiSurge = narrative.advancedStrategies.find((s) => s.type === ControlNarrative.CONTROL_TYPES.ANTI_SURGE);
  assert.ok(antiSurge);
  assert.ok(antiSurge.operationalDescription.includes('Surge Control Line (SCL)'));

  // Check Override Strategy
  const override = narrative.advancedStrategies.find((s) => s.type === ControlNarrative.CONTROL_TYPES.OVERRIDE);
  assert.ok(override, 'Must include OVERRIDE strategy');
  assert.equal(override.strategyTag, '40-OVC-4101');
  assert.equal(override.selectorType, 'LOW_SELECTOR');
  assert.ok(override.primaryController.includes('Suction'));
  assert.ok(override.secondaryController.includes('Discharge'));

  // Check Three-Element Level Strategy
  const threeElem = narrative.advancedStrategies.find((s) => s.type === ControlNarrative.CONTROL_TYPES.THREE_ELEMENT);
  assert.ok(threeElem, 'Must include THREE_ELEMENT boiler drum strategy');
  assert.equal(threeElem.strategyTag, '10-3EC-1301');

  // Check 2oo3 TMR Voting Safeguarding Interlock
  const interlock2oo3 = narrative.safeguardingInterlocks.find((i) => i.votingLogic === ControlNarrative.VOTING_LOGIC.TWO_OUT_OF_THREE);
  assert.ok(interlock2oo3);
  assert.equal(interlock2oo3.silTarget, 'SIL 3');
  assert.equal(interlock2oo3.sensors.length, 3);
  assert.ok(interlock2oo3.tripSetpoint);
  assert.ok(interlock2oo3.normalOperatingPoint);
  assert.ok(interlock2oo3.executiveActions.length >= 2);

  // Check 1oo2 Voting Safeguarding Interlock
  const interlock1oo2 = narrative.safeguardingInterlocks.find((i) => i.votingLogic === ControlNarrative.VOTING_LOGIC.ONE_OUT_OF_TWO);
  assert.ok(interlock1oo2, 'Must include 1oo2 interlock');
  assert.equal(interlock1oo2.interlockTag, '10-I-1201');
  assert.equal(interlock1oo2.silTarget, 'SIL 2');
  assert.equal(interlock1oo2.sensors.length, 2);
  assert.ok(interlock1oo2.tripSetpoint);

  // Markdown Export Check
  const md = narrative.toMarkdown();
  assert.ok(md.includes('# Process Control & Safeguarding Philosophy Specification'));
  assert.ok(md.includes('## 1. General Control Architecture & Philosophy'));
  assert.ok(md.includes('## 2. Regulatory PID Control Loops'));
  assert.ok(md.includes('## 3. Advanced & Coordinated Control Strategies'));
  assert.ok(md.includes('## 4. Safeguarding, Interlocks & Emergency Shutdown (SIS)'));
  assert.ok(md.includes('40-OVC-4101'));
  assert.ok(md.includes('10-3EC-1301'));
  assert.ok(md.includes('10-I-1201'));
});

// ============================================================================
// 7. MASTER API INTEGRATION
// ============================================================================

test('PlantEngineeringMasterApi.instrumentation Namespace Completeness', () => {
  const inst = PlantEngineeringMasterApi.instrumentation;
  assert.ok(inst, 'MasterApi must expose .instrumentation');
  assert.ok(inst.orificeIso5167, 'Exposes orificeIso5167');
  assert.ok(inst.flowmeterSelection, 'Exposes flowmeterSelection');
  assert.ok(inst.levelPressureTemperature, 'Exposes levelPressureTemperature');
  assert.ok(inst.instrumentIndex, 'Exposes instrumentIndex');
  assert.ok(inst.loopDiagramIld, 'Exposes loopDiagramIld');
  assert.ok(inst.controlNarrative, 'Exposes controlNarrative');
});
