'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PlantEngineeringMasterApi } = require('../src/core/plant/plant_engineering_master_api');

test('PlantEngineeringMasterApi: Complete Subdomain Integration', () => {
  // 1. Piping Mechanics
  const piping = PlantEngineeringMasterApi.piping;
  assert.ok(piping.standards, 'piping.standards must be defined');
  assert.ok(piping.materials['A106-B'], 'Carbon steel A106-B must be in material catalog');

  const pipeWall = piping.standards.calculateAsmeB31_3({
    materialId: 'A106-B',
    designPressureBarg: 50.0,
    designTempC: 150.0,
    outsideDiameterMm: 323.85, // 12" pipe OD
    corrosionAllowanceMm: 3.0
  });
  assert.ok(pipeWall.tNominalReqMm > 8.0, 'Pipe wall nominal thickness must be calculated');

  const sched = piping.standards.selectPipeSchedule('12', 'A106-B', 50.0, 150.0, 3.0);
  assert.ok(sched.selectedSchedule, 'Schedule must be selected');
  assert.strictEqual(sched.isCompliant, true);

  const hammer = piping.hydraulicTransients.analyzeWaterHammer({
    pipeLengthM: 1200.0,
    initialVelocityMS: 2.5,
    finalVelocityMS: 0.0,
    valveClosureTimeS: 0.5,
    steadyOperatingPressureBarg: 25.0,
    fluidDensityKgM3: 1000.0,
    fluidBulkModulusGPa: 2.19,
    pipeElasticModulusGPa: 200.0,
    pipeInsideDiameterMm: 300.0,
    pipeWallThicknessMm: 12.0,
    pipeMawpBarg: 80.0
  });
  assert.ok(hammer.actualSurgeBar > 10.0, 'Joukowsky surge pressure must be calculated');

  // 2. Thermodynamics
  const thermo = PlantEngineeringMasterApi.thermodynamics;
  const gasProps = thermo.gerg2008.evaluateState(
    40.0,
    25.0,
    { methane: 0.90, ethane: 0.06, propane: 0.03, nitrogen: 0.01 },
    'vapor'
  );
  assert.ok(gasProps.massDensityKgM3 > 20.0, 'Gas density calculated');
  assert.ok(gasProps.compressibilityZ > 0.8 && gasProps.compressibilityZ < 1.0, 'Gas Z factor valid');

  const hydrateTempC = thermo.flowAssurance.predictHydrateFormationTempC(70.0, 0.65);
  assert.ok(hydrateTempC > 10.0, 'Hydrate formation temp calculated');

  const megDose = thermo.flowAssurance.calculateInhibitorDosing({
    operatingTempC: -10.0,
    pressureBarg: 70.0,
    waterProductionKgH: 500.0,
    inhibitorType: 'MEG'
  });
  assert.ok(megDose.pureInhibitorRateKgH > 0, 'MEG inhibitor dosing rate calculated');

  // 3. Valves & Actuators
  const valves = PlantEngineeringMasterApi.valves;
  assert.ok(valves.catalog.ball_trunnion_api6d, 'Ball valve taxonomy present');
  assert.ok(valves.catalog.butterfly_triple_offset, 'TOV taxonomy present');

  const cvSize = valves.controlValveSizing.sizeLiquid({
    flowRateM3H: 150.0,
    inletPressureBarg: 20.0,
    outletPressureBarg: 14.0,
    vaporPressureBarg: 1.0,
    criticalPressureBarg: 220.0,
    densityKgM3: 900.0,
    valveRecoveryFactorFL: 0.90
  });
  assert.ok(cvSize.calculatedCv > 50.0, 'Control valve Cv calculated');

  const psvGas = valves.reliefValveSizing.sizeGasVapor({
    reliefRateKgH: 45000.0,
    setPressureBarg: 30.0,
    relievingTempC: 50.0,
    molecularWeight: 20.0,
    overpressurePercent: 10.0,
    backpressureBarg: 0.0,
    compressibilityZ: 0.92,
    specificHeatRatioGamma: 1.30
  });
  assert.ok(psvGas.selectedOrifice, 'API 526 orifice selected');

  const rotaryActuator = valves.actuatorDynamics.sizeRotaryActuator({
    valveType: 'ball',
    valveSizeIn: 12.0,
    maxShutoffDeltaPBar: 100.0,
    safetyFactor: 1.50
  });
  assert.ok(rotaryActuator.minimumActuatorTorqueNm > 5000.0, 'Actuator safety margin applied');

  // 4. Rotating Equipment
  const rotating = PlantEngineeringMasterApi.rotating;
  const comp = rotating.centrifugalCompressor.evaluateCompression({
    massFlowKgH: 200000,
    inletPressureBarg: 20.0,
    dischargePressureBarg: 65.0,
    inletTempC: 20.0,
    molecularWeight: 18.0,
    polytropicEfficiency: 0.82
  });
  assert.ok(comp.polytropicHeadKJkg > 0);
  assert.strictEqual(comp.casingType, 'barrel', 'Discharge > 60 bar mandates barrel casing');

  const pump = rotating.centrifugalPump.evaluatePumpOperatingPoint({
    flowRateM3H: 400.0,
    differentialHeadM: 95.0,
    liquidDensityKgM3: 850.0,
    speedRpm: 2950,
    bepEfficiency: 0.82,
    npshrAtBepM: 3.8,
    apiType: 'BB2'
  });
  assert.strictEqual(pump.api610Type, 'BB2');
  assert.ok(pump.shaftPowerKW > 0);

  const npsh = rotating.hydraulicAnalysis.evaluateNpsh({
    suctionVesselPressureBarg: 2.0,
    liquidVaporPressureBarg: 0.1,
    liquidDensityKgM3: 850.0,
    staticLiquidHeadM: 3.5,
    suctionFrictionLossM: 0.5,
    npshRequiredM: 3.8
  });
  assert.strictEqual(npsh.isCompliant, true);

  const sealPlan = rotating.hydraulicAnalysis.selectApi682SealPlan({
    isSourH2S: false,
    isCryogenic: true,
    isHighTemperature: false,
    hasAbrasiveSolids: false
  });
  assert.ok(sealPlan.pipingPlan.includes('Plan 72 / 74'));

  const pdPump = rotating.positiveDisplacementPump.evaluateReciprocatingPlunger({
    plungerDiameterMm: 50.0,
    strokeLengthMm: 100.0,
    speedRpm: 300,
    numberOfPlungers: 3,
    suctionPressureBarg: 1.5,
    dischargePressureBarg: 120.0,
    liquidDensityKgM3: 950.0,
    suctionPipeLengthM: 10.0,
    suctionPipeDiameterMm: 65.0
  });
  assert.ok(pdPump.actualCapacityM3H > 0);
  assert.ok(pdPump.accelerationHeadM > 0);
});

test('PlantEngineeringMasterApi: Phases 0-8 Multi-Discipline Registry Completeness', () => {
  // Phase 1: Expanded Piping & Materials
  const piping = PlantEngineeringMasterApi.piping;
  assert.ok(Object.keys(piping.materials).length >= 45, 'Material catalog must have >= 45 alloys');
  assert.ok(piping.nonmetallic, 'Nonmetallic piping B31.3 Ch VII present');
  assert.ok(piping.materialClassSpec, 'Piping material class spec present');
  assert.ok(piping.corrosion, 'API 570 corrosion & remaining life present');
  assert.ok(piping.insulation, 'ASTM C680 insulation & heat tracing present');
  assert.ok(piping.twoPhaseFlow, 'Two-phase flow engine present');
  assert.ok(piping.mtoBom, 'MTO/BOM generator present');
  assert.ok(piping.pipeSizingEngine, 'PipeSizingEngine present');

  // Phase 2: Expanded Rotating Equipment & Drivers
  const rotating = PlantEngineeringMasterApi.rotating;
  assert.ok(rotating.screwCompressor, 'API 619 screw compressor present');
  assert.ok(rotating.integrallyGearedCompressor, 'API 672 integrally geared compressor present');
  assert.ok(rotating.turboexpander, 'Turboexpander present');
  assert.ok(rotating.seallessPump, 'API 685 sealless pump present');
  assert.ok(rotating.meteringAndRotaryPump, 'API 675/676 pump present');
  assert.ok(rotating.slurryAndProgressiveCavityPump, 'Slurry/PC pump present');
  assert.ok(rotating.gasTurbineDriver, 'Gas turbine driver present');
  assert.ok(rotating.steamTurbineDriver, 'Steam turbine driver present');
  assert.ok(rotating.electricMotorDriver, 'Electric motor driver present');
  assert.ok(rotating.rotordynamicsVibration, 'API 684 rotordynamics present');
  assert.ok(rotating.lubeAndSealOil, 'API 614 lube & DGS present');

  // Phase 3: Expanded Valves & Chokes
  const valves = PlantEngineeringMasterApi.valves;
  assert.ok(valves.controlValveNoise, 'IEC 60534-8-3/8-4 noise engine present');
  assert.ok(valves.multiphaseChoke, 'Multiphase choke present');
  assert.ok(valves.tankBreathing, 'API 2000 tank breathing present');
  assert.ok(valves.ruptureDiscAndPsvHydraulics, 'API 520 Part II PSV hydraulics present');

  // Phase 0 Consolidated UnitOps & Layout
  const unitOps = PlantEngineeringMasterApi.unitOps;
  assert.ok(unitOps.rigorousDistillation, 'Rigorous distillation column solver present');
  assert.ok(unitOps.rateBasedDistillation, 'Rate-based packed column present');
  assert.ok(unitOps.plateFinExchanger, 'Brazed aluminum plate-fin MCHE present');
  assert.ok(unitOps.temaBellDelaware, 'TEMA Bell-Delaware exchanger present');
  assert.ok(unitOps.lngPlantEngine, '5.0 MTPA LNG plant engine present');
  assert.ok(unitOps.pidEngine, 'P&ID engine present');

  const layout = PlantEngineeringMasterApi.layout;
  assert.ok(layout.pipingStressCaesar, 'CAESAR II 3D FE stress solver present');
  assert.ok(layout.pcfExporter, 'PCF exporter present');
  assert.ok(layout.isometricGenerator, 'Isometric generator present');
  assert.ok(layout.nozzleLoadEvaluator, 'API 610 nozzle load evaluator present');

  // Phase 4: Instrumentation
  const inst = PlantEngineeringMasterApi.instrumentation;
  assert.ok(inst.orificeIso5167, 'ISO 5167 orifice sizing present');
  assert.ok(inst.flowmeterSelection, 'Flowmeter selection present');
  assert.ok(inst.levelPressureTemperature, 'Level/pressure/thermowell PTC 19.3 present');
  assert.ok(inst.instrumentIndex, 'Instrument index & I/O schedule present');
  assert.ok(inst.loopDiagramIld, 'ISA-5.4 ILD SVG generator present');
  assert.ok(inst.controlNarrative, 'Control narrative generator present');

  // Phase 5: Safety & SIS
  const safety = PlantEngineeringMasterApi.safety;
  assert.ok(safety.SifVerificationEngine && safety.calculateSubsystemPfd, 'IEC 61511 SIL engine present');
  assert.ok(safety.LopaStudy && safety.LopaScenario, 'LOPA engine present');
  assert.ok(safety.CauseEffectMatrix, 'Cause & Effect matrix present');
  assert.ok(safety.HazardousAreaClassifier, 'IEC 60079-10-1 classifier present');
  assert.ok(safety.FlareRadiationApi521, 'API 521 flare radiation present');
  assert.ok(safety.HazopStudyGenerator, 'IEC 61882 HAZOP generator present');
  assert.ok(safety.blowdownSimulatorApi521, 'API 521 vessel depressuring simulator present');

  // Phase 6: Electrical
  const elec = PlantEngineeringMasterApi.electrical;
  assert.ok(elec.ElectricalLoadList, 'Electrical load list present');
  assert.ok(elec.CableSizingIec60364, 'IEC 60364 cable sizing present');
  assert.ok(elec.ShortCircuitIec60909, 'IEC 60909 short circuit present');
  assert.ok(elec.TransformerGeneratorSizing, 'Transformer & GTG sizing present');
  assert.ok(elec.SingleLineDiagramGenerator, 'SLD SVG generator present');

  // Phase 7: Utilities & Process Units
  const util = PlantEngineeringMasterApi.utilities;
  assert.ok(util.CoolingWaterSystems, 'Cooling tower & seawater cooling present');
  assert.ok(util.SteamCondensateBalance, 'Multi-pressure steam balance present');
  assert.ok(util.InstrumentAirNitrogenSystems, 'Instrument air & N2 package present');
  assert.ok(util.FuelGasConditioningSystem, 'Fuel gas conditioning & Wobbe index present');
  assert.ok(util.WaterTreatmentSystems, 'Water treatment & NFPA 20 firewater present');
  assert.ok(util.iapwsIf97, 'IAPWS-IF97 steam tables present');

  const proc = PlantEngineeringMasterApi.process;
  assert.ok(proc.ClausSulfurRecoveryUnit, 'Claus SRU + SCOT kinetics present');
  assert.ok(proc.AmineTreatingUnit, 'aMDEA acid gas treating present');
  assert.ok(proc.LngRegasVaporizers, 'ORV/SCV/IFV regas vaporizers present');
  assert.ok(proc.AirCoolerApi661, 'API 661 air cooler present');
  assert.ok(proc.FiredHeaterApi560, 'API 560 fired heater present');

  // Phase 8: Multi-Discipline Deliverables
  const deliv = PlantEngineeringMasterApi.deliverables;
  assert.ok(deliv.MasterLineListGenerator, 'Master line list generator present');
  assert.ok(deliv.EquipmentDatasheetGenerator, 'Equipment datasheet generator present');
  assert.ok(deliv.MasterEquipmentListGenerator, 'Master equipment list & civil loads present');
  assert.ok(deliv.PlantPlotPlanEngine, 'Plant plot plan SVG engine present');
  assert.ok(deliv.FeedPackageCompiler, 'Master FEED package compiler present');
});

