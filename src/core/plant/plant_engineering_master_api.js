/**
 * Plant Engineering Master API & Unified Multi-Physics Registry.
 *
 * Provides a single, cohesive industrial-tier interface across:
 * 1. Piping Mechanics, Materials, Corrosion, Two-Phase Flow & MTO (ASME B31.1/3/4/8/12, B36.10/19, B16.5/47, Ch. VII Nonmetallics, API 570, ASTM C680, Joukowsky).
 * 2. Chemical Thermodynamics & Phase Equilibrium (GERG-2008, Peng-Robinson, SRK, NRTL/UNIQUAC/UNIFAC, eNRTL, IAPWS-IF97, DIPPR, Hydrate Flow Assurance, Petroleum Assays).
 * 3. Complete Valve Taxonomy, Sizing, Noise & Chokes (ISA-75.01, IEC 60534-8-3/8-4, API 520 / 526 PRVs, API 2000 Tank Breathing, Multiphase Chokes, Actuator Dynamics).
 * 4. Comprehensive Rotating Equipment & Drivers (API 617, API 618, API 619, API 672, Turboexpanders, API 610, API 674, API 675/676, API 685, Slurry/PC, GT/ST/Motor Drivers, API 684 Rotordynamics, API 614 Lube/DGS).
 * 5. Unit Operations & Flowsheet Simulation (Naphtali-Sandholm MESH, Rate-Based Columns, TEMA Bell-Delaware, Plate-Fin MCHE, Pinch, Wegstein, Dynamic Simulation, 5.0 MTPA LNG Plant, P&ID Engine).
 * 6. Instrumentation & Control (ISO 5167 Orifice/Venturi/Nozzle, Coriolis/Ultrasonic/Vortex, DP Level, ASME PTC 19.3 TW Thermowells, Instrument Index, ISA-5.4 ILD, Control Narratives).
 * 7. Process Safety & SIS (IEC 61511 SIL/PFDavg, CCPS LOPA, Cause & Effect Matrix, IEC 60079-10-1 Hazardous Area, Fire & Gas / NFPA 15, API 521 Flare Radiation & Blowdown, IEC 61882 HAZOP).
 * 8. Electrical Power Engineering (Load List, IEC 60364 Cable Sizing, IEC 60909 Short-Circuit, Transformer/GTG Sizing, Single-Line Diagram SVG).
 * 9. Utilities & Process Units (Cooling Tower, Multi-Pressure Steam Balance, Instrument Air/N2, Fuel Gas Wobbe Index, Water Treatment/NFPA 20, Claus SRU, aMDEA, Regas Vaporizers, API 661 ACHE, API 560 Fired Heater).
 * 10. Layout, 3D Piping, Stress & Multi-Discipline FEED Deliverables (CAESAR II 3D FE Stress, Supports, Nozzles, Isometrics, PCF, Line List, Equipment List, Datasheets, Plot Plan, FEED Package Compiler).
 */

'use strict';

// 1. Piping & Materials
const { AsmePipingStandards, getAsmeYFactor } = require('./piping/asme_piping_standards');
const { ASME_MATERIAL_CATALOG, getMaterialPropertiesAtTemp, resolveMaterial } = require('./piping/asme_material_stress_catalog');
const { PipingBranchReinforcement } = require('./piping/piping_branch_reinforcement');
const { HydraulicTransientsJoukowsky } = require('./piping/hydraulic_transients_joukowsky');
const { NonmetallicPipingB31_3, NONMETALLIC_MATERIALS } = require('./piping/nonmetallic_piping_b31_3_ch7');
const { PipingMaterialClassSpec, PIPING_MATERIAL_CLASSES } = require('./piping/piping_material_class_spec');
const { CorrosionRemainingLifeApi570, API_570_CLASS_INTERVALS } = require('./piping/corrosion_remaining_life_api570');
const { InsulationHeatTracing, INSULATION_MATERIALS } = require('./piping/insulation_heat_tracing');
const { TwoPhaseFlowEngine } = require('./piping/two_phase_flow');
const { MaterialTakeoffBom, ASME_B16_5_BOLTING_CATALOG } = require('./piping/material_takeoff_bom');
const { PipeSizingEngine, PIPE_SCHEDULE_DATABASE } = require('./pipe_sizing_engine');

// 2. Thermodynamics
const { Gerg2008Eos, GERG_COMPONENTS } = require('./thermodynamics/gerg2008_eos');
const { MultiEosEngine } = require('./thermodynamics/multi_eos_engine');
const { HydrateWaxFlowAssurance } = require('./thermodynamics/hydrate_wax_flow_assurance');
const { PetroleumAssayBlender } = require('./thermodynamics/petroleum_assay_blender');
const { ActivityModelsUNIFACNRTL } = require('./activity_models_unifac_nrtl');
const { ElectrolyteNRTLModel } = require('./enrtl_electrolyte_thermo');
const { DipprExpandedCatalog, getDipprCatalog } = require('./dippr_expanded_catalog');
const { CorrelationPropertyComponent, CorrelationSpeciesCatalog, DOCUMENTED_CORRELATION_SET } = require('./thermo_compounds');
const { IAPWS_IF97 } = require('./iapws_if97');

// 3. Valves
const { VALVE_TAXONOMY_CATALOG } = require('./valves/valve_taxonomy_catalog');
const { ControlValveSizingIsa75 } = require('./valves/control_valve_sizing_isa75');
const { PsvApi520Api526Full, API_526_ORIFICES } = require('./valves/psv_api520_api526_full');
const { ActuatorSizingDynamics } = require('./valves/actuator_sizing_dynamics');
const { ControlValveNoiseIec60534 } = require('./valves/control_valve_noise_iec60534_8');
const { MultiphaseChoke } = require('./valves/multiphase_choke');
const { TankBreathingApi2000 } = require('./valves/tank_breathing_api2000');
const { RuptureDiscAndPsvHydraulics } = require('./valves/rupture_disc_and_psv_inlet_outlet');

// 4. Rotating Equipment & Drivers
const { CompressorCentrifugalApi617 } = require('./rotating/compressor_centrifugal_api617');
const { CompressorReciprocatingApi618 } = require('./rotating/compressor_reciprocating_api618');
const { CompressorAntisurgeDynamics } = require('./rotating/compressor_antisurge_dynamics');
const { CompressorScrewApi619 } = require('./rotating/compressor_screw_api619');
const { CompressorIntegrallyGearedApi672 } = require('./rotating/compressor_integrally_geared_api672');
const { Turboexpander } = require('./rotating/turboexpander');
const { PumpCentrifugalApi610, API_610_PUMP_TYPES } = require('./rotating/pump_centrifugal_api610');
const { PumpHydraulicAnalysis } = require('./rotating/pump_hydraulic_analysis');
const { PumpPositiveDisplacement } = require('./rotating/pump_positive_displacement');
const { PumpSeallessApi685, CONTAINMENT_SHELL_MATERIALS } = require('./rotating/pump_sealless_api685');
const { PumpApi675Api676 } = require('./rotating/pump_api675_api676');
const { PumpSlurryProgressiveCavity } = require('./rotating/pump_slurry_progressive_cavity');
const { DriverGasTurbine, GAS_TURBINE_CATALOG } = require('./rotating/driver_gas_turbine');
const { DriverSteamTurbine } = require('./rotating/driver_steam_turbine');
const { DriverElectricMotor } = require('./rotating/driver_electric_motor');
const { RotordynamicsVibration } = require('./rotating/rotordynamics_vibration');
const { LubeSealOilApi614 } = require('./rotating/lube_seal_oil_api614');

// 5. Unit Operations & Flowsheet Simulation
const { RigorousDistillationColumnSolver } = require('./rigorous_distillation_column');
const { RateBasedPackedColumn, OndaCorrelations } = require('./rate_based_distillation');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('./naphtali_sandholm_mesh');
const { HeatExchangerTEMA } = require('./heat_exchanger_tema');
const { TemaBellDelaware } = require('./tema_bell_delaware');
const { PlateFinHeatExchanger } = require('./plate_fin_heat_exchanger');
const { PinchEnergyTargeter } = require('./pinch_energy_targeter');
const { ProcessStream, ProcessFlowsheetSolver } = require('./process_flowsheet_solver');
const { WegsteinRecycleSolver } = require('./wegstein_recycle_solver');
const { DynamicProcessSimulator } = require('./dynamic_process_simulation');
const { DynamicFlowsheetSolver } = require('./dynamic_flowsheet_solver');
const { LngPlantEngine } = require('./lng/lng_plant_engine');
const { PIDEngine } = require('./pid_engine');

// 6. Layout, 3D Piping, Stress & Isometrics
const { PipingIsometricGenerator, generateIsometricSvg, analyzeSpool } = require('./piping_isometric_generator');
const { PCFExporter, exportPCF, COMPONENT_TYPES, VALID_END_PREPS } = require('./pcf_export');
const { routePipe3D, aabbOverlap } = require('./piping_network_3d_router');
const { PipingSpecCatalog3D } = require('./piping_spec_catalog_3d');
const { EquipmentNozzleManager } = require('./equipment_nozzle_manager');
const { NozzleLoadEvaluator, API610_TABLE_5 } = require('./nozzle_load_evaluator');
const pipeSupportModule = require('./pipe_support_selector');
const {
  PipingFlexibilityCharacteristics,
  PipingStressEngine,
  PipingStressCaesarEngine,
  computeElbowFactors
} = require('./piping_stress_caesar');

// 7. Instrumentation
const OrificeIso5167 = require('./instrumentation/orifice_iso5167');
const FlowmeterSelection = require('./instrumentation/flowmeter_selection');
const LevelPressureTemperature = require('./instrumentation/level_pressure_temperature');
const InstrumentIndexModule = require('./instrumentation/instrument_index');
const LoopDiagramIld = require('./instrumentation/loop_diagram_ild');
const ControlNarrative = require('./instrumentation/control_narrative');

// 8. Safety, Electrical, Utilities, Process & Deliverables
const safetyModules = require('./safety');
const { VesselDepressuringSimulator, balanceFlareHeader, orificeMassFlow } = require('./flare_depressuring_api521');
const electricalModules = require('./electrical');
const utilitiesModules = require('./utilities');
const processModules = require('./process');
const deliverablesModules = require('./deliverables');

class PlantEngineeringMasterApi {
  // -------------------------------------------------------------
  // PIPING & MECHANICAL CODES
  // -------------------------------------------------------------
  static get piping() {
    return {
      standards: AsmePipingStandards,
      materials: ASME_MATERIAL_CATALOG,
      getMaterialPropertiesAtTemp,
      resolveMaterial,
      branchReinforcement: PipingBranchReinforcement,
      hydraulicTransients: HydraulicTransientsJoukowsky,
      getYFactor: getAsmeYFactor,
      nonmetallic: NonmetallicPipingB31_3,
      nonmetallicMaterials: NONMETALLIC_MATERIALS,
      materialClassSpec: PipingMaterialClassSpec,
      pipingClasses: PIPING_MATERIAL_CLASSES,
      corrosion: CorrosionRemainingLifeApi570,
      inspectionIntervals: API_570_CLASS_INTERVALS,
      insulation: InsulationHeatTracing,
      insulationMaterials: INSULATION_MATERIALS,
      twoPhaseFlow: TwoPhaseFlowEngine,
      mtoBom: MaterialTakeoffBom,
      boltingCatalog: ASME_B16_5_BOLTING_CATALOG,
      pipeSizingEngine: PipeSizingEngine,
      pipeScheduleDatabase: PIPE_SCHEDULE_DATABASE
    };
  }

  // -------------------------------------------------------------
  // CHEMICAL THERMODYNAMICS & EQUILIBRIUM
  // -------------------------------------------------------------
  static get thermodynamics() {
    return {
      gerg2008: Gerg2008Eos,
      gergComponents: GERG_COMPONENTS,
      multiEos: MultiEosEngine,
      flowAssurance: HydrateWaxFlowAssurance,
      petroleumAssay: PetroleumAssayBlender,
      activityModels: ActivityModelsUNIFACNRTL,
      electrolyteNrtl: ElectrolyteNRTLModel,
      dipprCatalog: DipprExpandedCatalog,
      getDipprCatalog,
      thermoCompounds: CorrelationSpeciesCatalog,
      iapwsIf97: IAPWS_IF97
    };
  }

  // -------------------------------------------------------------
  // VALVES, SIZING & ACTUATION
  // -------------------------------------------------------------
  static get valves() {
    return {
      catalog: VALVE_TAXONOMY_CATALOG,
      controlValveSizing: ControlValveSizingIsa75,
      reliefValveSizing: PsvApi520Api526Full,
      api526Orifices: API_526_ORIFICES,
      actuatorDynamics: ActuatorSizingDynamics,
      controlValveNoise: ControlValveNoiseIec60534,
      multiphaseChoke: MultiphaseChoke,
      tankBreathing: TankBreathingApi2000,
      ruptureDiscAndPsvHydraulics: RuptureDiscAndPsvHydraulics
    };
  }

  // -------------------------------------------------------------
  // ROTATING EQUIPMENT & DRIVERS (COMPRESSORS, PUMPS, TURBINES)
  // -------------------------------------------------------------
  static get rotating() {
    return {
      centrifugalCompressor: CompressorCentrifugalApi617,
      reciprocatingCompressor: CompressorReciprocatingApi618,
      antisurge: CompressorAntisurgeDynamics,
      screwCompressor: CompressorScrewApi619,
      integrallyGearedCompressor: CompressorIntegrallyGearedApi672,
      turboexpander: Turboexpander,
      centrifugalPump: PumpCentrifugalApi610,
      pumpTypes: API_610_PUMP_TYPES,
      hydraulicAnalysis: PumpHydraulicAnalysis,
      positiveDisplacementPump: PumpPositiveDisplacement,
      seallessPump: PumpSeallessApi685,
      containmentShellMaterials: CONTAINMENT_SHELL_MATERIALS,
      meteringAndRotaryPump: PumpApi675Api676,
      slurryAndProgressiveCavityPump: PumpSlurryProgressiveCavity,
      gasTurbineDriver: DriverGasTurbine,
      gasTurbineCatalog: GAS_TURBINE_CATALOG,
      steamTurbineDriver: DriverSteamTurbine,
      electricMotorDriver: DriverElectricMotor,
      rotordynamicsVibration: RotordynamicsVibration,
      lubeAndSealOil: LubeSealOilApi614
    };
  }

  // -------------------------------------------------------------
  // UNIT OPERATIONS & FLOWSHEET SIMULATION
  // -------------------------------------------------------------
  static get unitOps() {
    return {
      rigorousDistillation: RigorousDistillationColumnSolver,
      rateBasedDistillation: RateBasedPackedColumn,
      ondaCorrelations: OndaCorrelations,
      naphtaliSandholm: NaphtaliSandholmColumnSolver,
      waterHammerMoc: WaterHammerMOC,
      heatExchangerTema: HeatExchangerTEMA,
      temaBellDelaware: TemaBellDelaware,
      plateFinExchanger: PlateFinHeatExchanger,
      pinchTargeter: PinchEnergyTargeter,
      processStream: ProcessStream,
      flowsheetSolver: ProcessFlowsheetSolver,
      wegsteinSolver: WegsteinRecycleSolver,
      dynamicSimulator: DynamicProcessSimulator,
      dynamicFlowsheetSolver: DynamicFlowsheetSolver,
      lngPlantEngine: LngPlantEngine,
      pidEngine: PIDEngine
    };
  }

  // -------------------------------------------------------------
  // LAYOUT, 3D PIPING, STRESS & ISOMETRICS
  // -------------------------------------------------------------
  static get layout() {
    return {
      isometricGenerator: PipingIsometricGenerator,
      generateIsometricSvg,
      analyzeSpool,
      pcfExporter: PCFExporter,
      exportPCF,
      pcfComponentTypes: COMPONENT_TYPES,
      pcfValidEndPreps: VALID_END_PREPS,
      routePipe3D,
      aabbOverlap,
      specCatalog3D: PipingSpecCatalog3D,
      nozzleManager: EquipmentNozzleManager,
      nozzleLoadEvaluator: NozzleLoadEvaluator,
      api610Table5: API610_TABLE_5,
      pipeSupportSelector: pipeSupportModule,
      pipingStressCaesar: PipingStressCaesarEngine,
      pipingStressEngine: PipingStressEngine,
      pipingFlexibility: PipingFlexibilityCharacteristics,
      computeElbowFactors
    };
  }

  // -------------------------------------------------------------
  // INSTRUMENTATION & CONTROL DISCIPLINE (PHASE 4)
  // -------------------------------------------------------------
  static get instrumentation() {
    return {
      orificeIso5167: OrificeIso5167,
      flowmeterSelection: FlowmeterSelection,
      levelPressureTemperature: LevelPressureTemperature,
      instrumentIndex: InstrumentIndexModule,
      loopDiagramIld: LoopDiagramIld,
      controlNarrative: ControlNarrative
    };
  }

  // -------------------------------------------------------------
  // PROCESS SAFETY, SIS, LOPA, C&E & HAZARDOUS AREA (PHASE 5)
  // -------------------------------------------------------------
  static get safety() {
    return {
      ...safetyModules,
      blowdownSimulatorApi521: VesselDepressuringSimulator,
      balanceFlareHeader,
      orificeMassFlow
    };
  }

  // -------------------------------------------------------------
  // ELECTRICAL ENGINEERING DISCIPLINE (PHASE 6)
  // -------------------------------------------------------------
  static get electrical() {
    return electricalModules;
  }

  // -------------------------------------------------------------
  // PLANT UTILITIES DISCIPLINE (PHASE 7A)
  // -------------------------------------------------------------
  static get utilities() {
    return {
      ...utilitiesModules,
      iapwsIf97: IAPWS_IF97
    };
  }

  // -------------------------------------------------------------
  // REMAINING PROCESS UNITS DISCIPLINE (PHASE 7B)
  // -------------------------------------------------------------
  static get process() {
    return processModules;
  }

  // -------------------------------------------------------------
  // MULTI-DISCIPLINE FEED DELIVERABLES (PHASE 8)
  // -------------------------------------------------------------
  static get deliverables() {
    return deliverablesModules;
  }
}

module.exports = {
  PlantEngineeringMasterApi,
  AsmePipingStandards,
  ASME_MATERIAL_CATALOG,
  getMaterialPropertiesAtTemp,
  resolveMaterial,
  PipingBranchReinforcement,
  HydraulicTransientsJoukowsky,
  NonmetallicPipingB31_3,
  NONMETALLIC_MATERIALS,
  PipingMaterialClassSpec,
  PIPING_MATERIAL_CLASSES,
  CorrosionRemainingLifeApi570,
  API_570_CLASS_INTERVALS,
  InsulationHeatTracing,
  INSULATION_MATERIALS,
  TwoPhaseFlowEngine,
  MaterialTakeoffBom,
  ASME_B16_5_BOLTING_CATALOG,
  PipeSizingEngine,
  PIPE_SCHEDULE_DATABASE,
  Gerg2008Eos,
  GERG_COMPONENTS,
  MultiEosEngine,
  HydrateWaxFlowAssurance,
  PetroleumAssayBlender,
  ActivityModelsUNIFACNRTL,
  ElectrolyteNRTLModel,
  DipprExpandedCatalog,
  getDipprCatalog,
  CorrelationPropertyComponent,
  CorrelationSpeciesCatalog,
  DOCUMENTED_CORRELATION_SET,
  IAPWS_IF97,
  VALVE_TAXONOMY_CATALOG,
  ControlValveSizingIsa75,
  PsvApi520Api526Full,
  API_526_ORIFICES,
  ActuatorSizingDynamics,
  ControlValveNoiseIec60534,
  MultiphaseChoke,
  TankBreathingApi2000,
  RuptureDiscAndPsvHydraulics,
  CompressorCentrifugalApi617,
  CompressorReciprocatingApi618,
  CompressorAntisurgeDynamics,
  CompressorScrewApi619,
  CompressorIntegrallyGearedApi672,
  Turboexpander,
  PumpCentrifugalApi610,
  API_610_PUMP_TYPES,
  PumpHydraulicAnalysis,
  PumpPositiveDisplacement,
  PumpSeallessApi685,
  CONTAINMENT_SHELL_MATERIALS,
  PumpApi675Api676,
  PumpSlurryProgressiveCavity,
  DriverGasTurbine,
  GAS_TURBINE_CATALOG,
  DriverSteamTurbine,
  DriverElectricMotor,
  RotordynamicsVibration,
  LubeSealOilApi614,
  RigorousDistillationColumnSolver,
  RateBasedPackedColumn,
  OndaCorrelations,
  NaphtaliSandholmColumnSolver,
  WaterHammerMOC,
  HeatExchangerTEMA,
  TemaBellDelaware,
  PlateFinHeatExchanger,
  PinchEnergyTargeter,
  ProcessStream,
  ProcessFlowsheetSolver,
  WegsteinRecycleSolver,
  DynamicProcessSimulator,
  DynamicFlowsheetSolver,
  LngPlantEngine,
  PIDEngine,
  PipingIsometricGenerator,
  generateIsometricSvg,
  analyzeSpool,
  PCFExporter,
  exportPCF,
  COMPONENT_TYPES,
  VALID_END_PREPS,
  routePipe3D,
  aabbOverlap,
  PipingSpecCatalog3D,
  EquipmentNozzleManager,
  NozzleLoadEvaluator,
  API610_TABLE_5,
  PipingFlexibilityCharacteristics,
  PipingStressEngine,
  PipingStressCaesarEngine,
  computeElbowFactors,
  VesselDepressuringSimulator,
  balanceFlareHeader,
  orificeMassFlow,
  OrificeIso5167,
  FlowmeterSelection,
  LevelPressureTemperature,
  InstrumentIndexModule,
  LoopDiagramIld,
  ControlNarrative,
  safety: safetyModules,
  ...safetyModules,
  electrical: electricalModules,
  ...electricalModules,
  utilities: utilitiesModules,
  ...utilitiesModules,
  process: processModules,
  ...processModules,
  deliverables: deliverablesModules,
  ...deliverablesModules
};
