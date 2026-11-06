/**
 * OmniEng Plant & Chemical Process Domain IPC Router & Schema Definitions
 * Plant calculation IPC routes. All calculation domains remain experimental.
 */

'use strict';

const { defineHandler } = require('./define_handler');
const { ThermodynamicsEngine } = require('../../core/plant/thermodynamics');
const { PipingStressEngine } = require('../../core/plant/piping_stress');
const { VLEPhaseEnvelopeEngine } = require('../../core/plant/vle_envelope');
const { ProcessStream, ProcessFlowsheetSolver } = require('../../core/plant/process_flowsheet_solver');
const { PengRobinsonEOS } = require('../../core/plant/peng_robinson_eos');
const { TemaBellDelaware } = require('../../core/plant/tema_bell_delaware');
const { Api520ReliefValve } = require('../../core/plant/api520_relief_valve');
const { IAPWS_IF97 } = require('../../core/plant/iapws_if97');
const { TransientWaterHammerSolver } = require('../../core/plant/transient_water_hammer');
const { defaultEngineRegistry } = require('../../core/contracts/engine_registry');
const { JobRequest } = require('../../core/contracts/JobRequest');
const {
  PipingStressEngine: CaesarPipingStressEngine,
  PipingFlexibilityCharacteristics
} = require('../../core/plant/piping_stress_caesar');
const { PipingSpecCatalog3D, MATERIAL_ALLOWABLE_STRESS_MPA } = require('../../core/plant/piping_spec_catalog_3d');
const { PCFExporter, exportPCF } = require('../../core/plant/pcf_export');
const asmePipingCatalogData = require('../../core/plant/data/asme_piping_catalog.json');

const WATER_HAMMER_MOC_SCHEMA = Object.freeze({
  type: 'object',
  optional: true,
  additionalProperties: false,
  properties: {
    fluidDensity: { type: 'number', min: Number.MIN_VALUE },
    fluidBulkModulus: { type: 'number', min: Number.MIN_VALUE },
    pipeElasticModulus: { type: 'number', min: Number.MIN_VALUE },
    pipeWallThickness: { type: 'number', min: Number.MIN_VALUE },
    restraintFactor: { type: 'number', min: 0 },
    pipeDiameter: { type: 'number', min: Number.MIN_VALUE },
    pipeInnerDiameter: { type: 'number', min: Number.MIN_VALUE },
    steadyVelocity: { type: 'number' },
    steadyFlowRate: { type: 'number', min: 0 },
    runMOC: { type: 'boolean' },
    pipeLength: { type: 'number', min: Number.MIN_VALUE },
    darcyFrictionFactor: { type: 'number', min: 0 },
    reservoirHead: { type: 'number', min: Number.MIN_VALUE },
    valveClosureTime: { type: 'number', min: Number.MIN_VALUE },
    valveClosureLaw: { type: 'string', enum: ['instantaneous', 'linear', 's_curve'] },
    simulationDuration: { type: 'number', min: Number.MIN_VALUE },
    reaches: { type: 'number', integer: true, min: 4, max: 2000 }
  }
});

const NRTL_ACTIVITY_SCHEMA = Object.freeze({
  type: 'object',
  optional: true,
  additionalProperties: false,
  properties: {
    liquidComposition: { type: 'array', minItems: 2, maxItems: 100, items: { type: 'number' } },
    temperatureK: { type: 'number', min: Number.MIN_VALUE },
    delta_g: {
      type: 'array',
      minItems: 2,
      maxItems: 100,
      items: { type: 'array', minItems: 2, maxItems: 100, items: { type: 'number' } }
    },
    alpha: {
      type: 'array',
      minItems: 2,
      maxItems: 100,
      items: { type: 'array', minItems: 2, maxItems: 100, items: { type: 'number' } }
    }
  }
});

const ASME_PIPING_CATALOG_SCHEMA = Object.freeze({
  type: 'object',
  optional: true,
  properties: {
    nps: { type: 'string' },
    schedule: { type: 'string' },
    rating: { type: 'string' },
    classRating: { type: 'string' },
    material: { type: 'string' },
    temperature_C: { type: 'number' },
    corrosionAllowance_mm: { type: 'number' },
    query: { type: 'string' },
    componentType: { type: 'string' },
    fitting: { type: 'boolean' }
  }
});

const PIPING_3D_GEOMETRY_SCHEMA = Object.freeze({
  type: 'object',
  optional: true,
  properties: {
    componentType: { type: 'string' },
    type: { type: 'string' },
    nps: { type: 'string' },
    schedule: { type: 'string' },
    length_mm: { type: 'number' },
    length: { type: 'number' },
    rating: { type: 'string' },
    classRating: { type: 'string' },
    flangeType: { type: 'string' }
  }
});

const CAESAR_STRESS_ANALYSIS_SCHEMA = Object.freeze({
  type: 'object',
  optional: true,
  properties: {
    analysisType: { type: 'string' },
    nps: { type: 'string' },
    schedule: { type: 'string' },
    material: { type: 'string' },
    temperature_C: { type: 'number' },
    operatingTempC: { type: 'number' },
    ambientTempC: { type: 'number' },
    runLength_m: { type: 'number' },
    offset_m: { type: 'number' },
    Do_m: { type: 'number' },
    t_m: { type: 'number' },
    pressure_Pa: { type: 'number' },
    pressure_bar: { type: 'number' },
    E_Pa: { type: 'number' },
    alpha_perC: { type: 'number' },
    Sc_Pa: { type: 'number' },
    Sh_Pa: { type: 'number' },
    corrosionAllowance_mm: { type: 'number' },
    nozzle: { type: 'object' },
    support: { type: 'object' }
  }
});

const PCF_EXPORT_SCHEMA = Object.freeze({
  type: 'object',
  optional: true,
  properties: {
    components: { type: 'array' },
    pipelineRef: { type: 'string' },
    projectName: { type: 'string' },
    options: { type: 'object' }
  }
});

function getPlantPropertyCatalogUnavailableResult() {
  return {
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: {
      code: 'UNSUPPORTED',
      message:
        'Plant property examples are unavailable until source, applicability, and redistribution rights are reviewed.'
    }
  };
}

function getVlleFlashUnavailableResult() {
  return {
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: {
      code: 'UNSUPPORTED',
      message:
        'VLLE flash is unavailable until its property data and phase-equilibrium model receive independent review.'
    }
  };
}

function registerPlantIpc() {
  const unavailable = (message) => ({
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: message
  });
  const requireFields = (params, fields) => {
    if (!params || typeof params !== 'object' || Array.isArray(params)) return fields;
    return fields.filter((field) => params[field] === undefined || params[field] === null);
  };

  // 1. Experimental Wilson/Rachford-Rice VLE estimate (legacy channel name retained).
  defineHandler(
    'omni:solve-hysys-flash',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const missing = requireFields(params, ['feedComposition', 'tempC', 'pressureBar', 'componentProperties']);
      if (missing.length) return unavailable(`Required inputs missing: ${missing.join(', ')}`);
      const { feedComposition, tempC, pressureBar, componentProperties } = params;
      return ThermodynamicsEngine.flashVLE(feedComposition, tempC, pressureBar, componentProperties);
    },
    {
      domain: 'plant',
      description: 'Run an experimental Wilson/Rachford-Rice estimate with caller-supplied property records'
    }
  );

  // 2. Distillation Column Simulation
  defineHandler(
    'omni:simulate-distillation',
    {
      type: 'object',
      optional: true
    },
    async () => {
      return ThermodynamicsEngine.simulateDistillationColumn();
    },
    {
      domain: 'plant',
      description: 'Unavailable: no sourced assay, column model, or independent fractionation reference'
    }
  );

  // 3. ASME B31.3 Piping Stress
  defineHandler(
    'omni:evaluate-piping-stress',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      return PipingStressEngine.evaluateASMEB313(params);
    },
    {
      domain: 'plant',
      description:
        'Run an experimental piping estimate from explicit user-supplied inputs; no code allowable or compliance decision is provided'
    }
  );

  // 4. VLE P-T Phase Envelope
  defineHandler(
    'omni:get-vle-envelope',
    {
      type: 'object',
      optional: true
    },
    async (event, { composition, pMinBar, pMaxBar, points, componentProperties, tMinC, tMaxC } = {}) => {
      if (
        [composition, pMinBar, pMaxBar, points, componentProperties, tMinC, tMaxC].some(
          (value) => value === undefined || value === null
        )
      ) {
        return unavailable(
          'Required inputs missing: composition, componentProperties, pMinBar, pMaxBar, points, tMinC, tMaxC'
        );
      }
      return VLEPhaseEnvelopeEngine.generatePTEnvelope(
        composition,
        pMinBar,
        pMaxBar,
        points,
        componentProperties,
        tMinC,
        tMaxC
      );
    },
    {
      domain: 'plant',
      description: 'Generate an experimental phase-envelope estimate with caller-supplied property records'
    }
  );

  // 5. Column Tray Profile (legacy channel retained; synthetic profile withdrawn)
  defineHandler(
    'omni:get-column-profile',
    {
      type: 'object',
      optional: true
    },
    async () => VLEPhaseEnvelopeEngine.generateColumnTrayProfile(),
    {
      domain: 'plant',
      description:
        'Unavailable: synthetic tray profiles were withdrawn pending sourced assay, reviewed model, and independent reference'
    }
  );

  // 6. Cyclic Process Flowsheet (PFD)
  defineHandler(
    'omni:solve-flowsheet',
    {
      type: 'object',
      optional: true
    },
    async (event, config = {}) => {
      return unavailable('Flowsheet IPC does not yet accept a validated user flowsheet schema.');
    },
    { domain: 'plant', description: 'Unavailable pending a validated user flowsheet schema' }
  );

  // 7. Unavailable property catalog query (legacy channel name retained)
  defineHandler(
    'omni:query-dippr-database',
    {
      optional: true
    },
    async () => getPlantPropertyCatalogUnavailableResult(),
    {
      domain: 'plant',
      description: 'Unavailable pending plant property source, applicability, and redistribution review'
    }
  );

  // 8. Unavailable VLLE flash until its data and model are reviewed
  defineHandler(
    'omni:solve-vlle-flash',
    {
      type: 'object',
      optional: true
    },
    async () => getVlleFlashUnavailableResult(),
    {
      domain: 'plant',
      description: 'Unavailable pending independent review of property data and the VLLE model'
    }
  );

  // 9. Naphtali-Sandholm Simultaneous MESH Distillation
  defineHandler(
    'omni:solve-mesh-distillation',
    {
      type: 'object',
      optional: true
    },
    async () =>
      unavailable(
        'Distillation is unavailable until a reviewed phase-equilibrium and enthalpy model, property data, and independent column reference are configured.'
      ),
    { domain: 'plant', description: 'Unavailable pending a reviewed column model and independent reference' }
  );

  // 10. Water Hammer Method of Characteristics (MOC)
  defineHandler(
    'omni:solve-water-hammer-moc',
    WATER_HAMMER_MOC_SCHEMA,
    async (event, params = {}) => {
      const missingBase = requireFields(params, [
        'fluidDensity',
        'fluidBulkModulus',
        'pipeElasticModulus',
        'pipeWallThickness',
        'restraintFactor',
        'runMOC'
      ]);
      if (missingBase.length) return unavailable(`Required inputs missing: ${missingBase.join(', ')}`);
      if (typeof params.runMOC !== 'boolean') return unavailable('runMOC must be an explicit boolean choice.');
      if (![params.pipeDiameter, params.pipeInnerDiameter].some((value) => value !== undefined && value !== null)) {
        return unavailable('Required input missing: pipeDiameter or pipeInnerDiameter.');
      }
      if (![params.steadyVelocity, params.steadyFlowRate].some((value) => value !== undefined && value !== null)) {
        return unavailable('Required input missing: steadyVelocity or steadyFlowRate.');
      }
      if (params.runMOC === true) {
        const missingMoc = requireFields(params, [
          'pipeLength',
          'darcyFrictionFactor',
          'reservoirHead',
          'valveClosureTime',
          'valveClosureLaw',
          'simulationDuration',
          'reaches'
        ]);
        if (missingMoc.length) return unavailable(`Required MOC inputs missing: ${missingMoc.join(', ')}`);
      }
      try {
        const jobResult = await defaultEngineRegistry.dispatch(
          new JobRequest({
            domain: 'plant',
            operation: 'calculate_water_hammer',
            parameters: params
          })
        );
        return {
          success: true,
          validationLevel: 'experimental',
          jobId: jobResult.jobId,
          ...(jobResult.outputData || {})
        };
      } catch (error) {
        return unavailable(`Water-hammer solve failed: ${error.message}`);
      }
    },
    {
      domain: 'plant',
      description:
        'Run the explicit-input Method-of-Characteristics water-hammer transient through the Plant engine adapter (calculate_water_hammer)'
    }
  );

  // 11. Peng-Robinson 1978 EOS Flash
  defineHandler(
    'omni:flash-peng-robinson',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const missing = requireFields(params, ['components', 'k_ij', 'z', 'T', 'P', 'maxIter', 'tol']);
      if (missing.length) return unavailable(`Required inputs missing: ${missing.join(', ')}`);
      const eos = new PengRobinsonEOS(params.components, params.k_ij);
      const flash = eos.flashPT(params.z, params.T, params.P, { maxIter: params.maxIter, tol: params.tol });
      return { success: true, validationLevel: 'experimental', flash };
    },
    { domain: 'plant', description: 'Run an experimental PR-78 flash from explicit inputs' }
  );

  // 12. TEMA Shell & Tube Heat Exchanger Rating
  defineHandler(
    'omni:rate-tema-heat-exchanger',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const missing = requireFields(params, ['geom', 'fluid']);
      if (missing.length) return unavailable(`Required inputs missing: ${missing.join(', ')}`);
      const tema = new TemaBellDelaware(params.geom);
      const rating = tema.rateShellSide(params.fluid);
      return { success: true, validationLevel: 'experimental', rating };
    },
    { domain: 'plant', description: 'Run an experimental Bell-Delaware estimate from explicit inputs' }
  );

  // 13. API 520 / API 526 Pressure Relief Valve (PRV) Sizing
  defineHandler(
    'omni:size-api520-prv',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const missing = requireFields(params, ['massFlow', 'P1', 'Pb', 'T', 'M', 'k']);
      if (missing.length) return unavailable(`Required inputs missing: ${missing.join(', ')}`);
      const sizing = Api520ReliefValve.sizeGasVapor(params);
      return { success: true, validationLevel: 'experimental', sizing };
    },
    { domain: 'plant', description: 'Run an experimental relief-area estimate from explicit inputs' }
  );

  // 14. Non-Ideal Liquid Thermodynamics (NRTL & UNIQUAC)
  defineHandler(
    'omni:plant-nrtl-activity',
    NRTL_ACTIVITY_SCHEMA,
    async (event, params = {}) => {
      const missing = requireFields(params, ['liquidComposition', 'temperatureK', 'delta_g', 'alpha']);
      if (missing.length) return unavailable(`Required inputs missing: ${missing.join(', ')}`);
      try {
        const jobResult = await defaultEngineRegistry.dispatch(
          new JobRequest({
            domain: 'plant',
            operation: 'calculate_nrtl_activity',
            parameters: params
          })
        );
        return {
          success: true,
          validationLevel: 'experimental',
          jobId: jobResult.jobId,
          ...(jobResult.outputData || {})
        };
      } catch (error) {
        return unavailable(`NRTL activity solve failed: ${error.message}`);
      }
    },
    {
      domain: 'plant',
      description:
        'Calculate NRTL liquid activity coefficients from explicit caller-supplied composition, temperature, and interaction parameters through the Plant engine adapter (calculate_nrtl_activity)'
    }
  );

  // 15. Electrolyte NRTL (eNRTL) Ionic Thermodynamics & CO2 Capture
  defineHandler(
    'omni:evaluate-enrtl-co2',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const { ElectrolyteNRTLModel } = require('../../core/plant/enrtl_electrolyte_thermo');
      const missing = requireFields(params, [
        'temperatureK',
        'meaMassFraction',
        'co2Loading',
        'richLoading',
        'leanLoading',
        'liquidFlowKgH'
      ]);
      if (missing.length) return unavailable(`Required inputs missing: ${missing.join(', ')}`);
      const model = new ElectrolyteNRTLModel({
        temperatureK: params.temperatureK !== undefined ? params.temperatureK : 313.15,
        meaMassFraction: params.meaMassFraction !== undefined ? params.meaMassFraction : 0.3
      });
      const co2Loading = params.co2Loading !== undefined ? params.co2Loading : 0.35;
      const speciation = model.calculateSpeciation(co2Loading);
      const vle = model.calculateCO2VLE(co2Loading, params.temperatureK);
      const richLoading = params.richLoading !== undefined ? params.richLoading : 0.48;
      const leanLoading = params.leanLoading !== undefined ? params.leanLoading : 0.2;
      const liquidFlowKgH = params.liquidFlowKgH !== undefined ? params.liquidFlowKgH : 100000.0;
      const capture = model.evaluateCaptureCapacity(richLoading, leanLoading, liquidFlowKgH);
      return { success: true, validationLevel: 'experimental', speciation, vle, capture };
    },
    { domain: 'plant', description: 'Run an experimental eNRTL example from explicit inputs' }
  );

  // 16. Experimental cryogenic loading route; production model availability is checked by solver
  defineHandler(
    'omni:solve-cryogenic-loading',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      return ProcessFlowsheetSolver.solveCryogenicLoadingCycle(params);
    },
    {
      domain: 'plant',
      description: 'Experimental cryogenic loading route; no independent process reference is established'
    }
  );

  // 17. IAPWS-IF97 Water & Steam Thermodynamic Properties
  defineHandler(
    'omni:calculate-steam-properties',
    {
      type: 'object',
      optional: true
    },
    async (event, payload = {}) => {
      const temperatureK = Number(payload?.temperatureK);
      if (!Number.isFinite(temperatureK)) {
        throw new Error('calculate-steam-properties requires finite temperatureK.');
      }

      let pressurePa;
      let pressureMPa;
      if (payload?.pressureMPa !== undefined) {
        const p = Number(payload.pressureMPa);
        if (!Number.isFinite(p)) throw new Error('calculate-steam-properties requires finite pressureMPa.');
        pressurePa = p * 1e6;
        pressureMPa = p;
      } else if (payload?.pressurePa !== undefined) {
        const p = Number(payload.pressurePa);
        if (!Number.isFinite(p)) throw new Error('calculate-steam-properties requires finite pressurePa.');
        pressurePa = p;
        pressureMPa = p / 1e6;
      } else if (payload?.pressureBar !== undefined) {
        const p = Number(payload.pressureBar);
        if (!Number.isFinite(p)) throw new Error('calculate-steam-properties requires finite pressureBar.');
        pressurePa = p * 1e5;
        pressureMPa = p * 0.1;
      } else {
        throw new Error(
          'calculate-steam-properties requires pressureMPa, pressurePa, or pressureBar, and temperatureK.'
        );
      }

      // IAPWS-IF97 numeric domain bounds (regions 1, 2, 4, 5):
      // P in [0.000611, 100] MPa; T in [273.15, 2273.15] K; P <= 50 MPa above 1073.15 K.
      if (temperatureK < 273.15 || temperatureK > 2273.15) {
        return {
          success: false,
          error: { code: 'INVALID_INPUT', message: 'temperatureK must be within [273.15, 2273.15] K.' }
        };
      }
      const maxPressureMPa = temperatureK > 1073.15 ? 50.0 : 100.0;
      if (pressureMPa < 0.000611 || pressureMPa > maxPressureMPa) {
        return {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: `pressure must be within [0.000611, ${maxPressureMPa}] MPa for the IAPWS-IF97 domain.`
          }
        };
      }

      const props = IAPWS_IF97.calculateProperties(pressurePa, temperatureK);
      return {
        success: true,
        pressureMPa,
        densityKgM3: props.density_kg_m3,
        enthalpyKJkg: Number.isFinite(props.specificEnthalpy_J_kg) ? props.specificEnthalpy_J_kg / 1000 : undefined,
        entropyKJkgK: Number.isFinite(props.specificEntropy_J_kg_K) ? props.specificEntropy_J_kg_K / 1000 : undefined,
        ...props
      };
    },
    {
      domain: 'plant',
      description: 'Calculate IAPWS-IF97 water and steam thermodynamic properties (Regions 1, 2, 4, 5)'
    }
  );

  // 18. P&ID generation (ISA-5.1 / ISO 14617 symbology) — experimental drawing generation.
  defineHandler(
    'omni:generate-p-id',
    {
      type: 'object',
      required: ['template'],
      additionalProperties: false,
      properties: {
        template: { type: 'string', enum: ['oilgas', 'lng'] },
        options: { type: 'object', optional: true }
      }
    },
    async (event, { template, options } = {}) => {
      const { PIDEngine } = require('../../core/plant/pid_engine');
      const engine = new PIDEngine(options || {});
      const config =
        template === 'lng' ? PIDEngine.lngPlantTemplate() : PIDEngine.oilGasProductionTemplate();
      const result = engine.createPID(config);
      if (!result.success) {
        return {
          success: false,
          status: 'validation-failed',
          validationLevel: 'experimental',
          error: { code: 'INVALID_PID_CONFIG', message: result.validation.errors.join('; ') },
          validation: result.validation
        };
      }
      return {
        success: true,
        validationLevel: 'experimental',
        sheets: result.sheets,
        schedule: result.schedule,
        validation: result.validation,
        note: 'P&ID drawing is an experimental engineering deliverable; verify against project basis before fabrication.'
      };
    },
    {
      domain: 'plant',
      description: 'Generate an ISA-5.1-style P&ID sheet for an oil & gas production facility'
    }
  );

  // 19. ASME Piping Component Catalog
  defineHandler(
    'plant:get-asme-piping-catalog',
    ASME_PIPING_CATALOG_SCHEMA,
    async (event, params = {}) => {
      try {
        const npsSizes = Object.keys(asmePipingCatalogData.pipes);
        const materials = Object.keys(MATERIAL_ALLOWABLE_STRESS_MPA);
        const flangeRatings = ['150', '300', '400', '600', '900', '1500', '2500'];
        const scheduleSet = new Set();
        for (const pipe of Object.values(asmePipingCatalogData.pipes)) {
          for (const s of Object.keys(pipe.schedules)) {
            scheduleSet.add(s);
          }
        }
        const schedules = Array.from(scheduleSet);
        const counts = PipingSpecCatalog3D.enumerateComponentCounts();

        const result = {
          success: true,
          npsSizes,
          schedules,
          flangeRatings,
          materials,
          materialAllowableStresses: MATERIAL_ALLOWABLE_STRESS_MPA,
          componentCounts: counts
        };

        if (params.nps) {
          const nps = String(params.nps);
          if (params.schedule) {
            result.pipe = PipingSpecCatalog3D.getPipeSpec(nps, String(params.schedule));
          } else if (asmePipingCatalogData.pipes[nps]) {
            result.pipe = PipingSpecCatalog3D.getPipeSpec(nps, '40');
            result.availableSchedules = Object.keys(asmePipingCatalogData.pipes[nps].schedules);
          }

          const rating = params.rating || params.classRating;
          if (rating && asmePipingCatalogData.flanges[nps]) {
            result.flange = PipingSpecCatalog3D.getFlangeSpec(nps, String(rating));
          }

          if (params.fitting || params.componentType === 'fitting') {
            result.fitting = PipingSpecCatalog3D.getFittingSpec(nps);
          }

          if (params.material && params.temperature_C !== undefined) {
            result.mawp = PipingSpecCatalog3D.calculateAllowablePressure({
              nps,
              schedule: params.schedule || '40',
              material: params.material,
              temperature_C: params.temperature_C,
              corrosionAllowance_mm: params.corrosionAllowance_mm !== undefined ? params.corrosionAllowance_mm : 1.5
            });
          }
        }

        return result;
      } catch (err) {
        return {
          success: false,
          error: { code: 'CATALOG_ERROR', message: err.message }
        };
      }
    },
    {
      domain: 'plant',
      description: 'Query ASME piping catalog for NPS sizes, schedules, flange ratings, and material allowable stresses'
    }
  );

  // 20. 3D Parametric Piping Geometry Synthesizer
  defineHandler(
    'plant:generate-piping-3d-geometry',
    PIPING_3D_GEOMETRY_SCHEMA,
    async (event, params = {}) => {
      try {
        const compType = (params.componentType || params.type || 'pipe').toLowerCase();
        const nps = String(params.nps || '4');
        const schedule = String(params.schedule || '40');

        let mesh;
        if (compType.includes('elbow') || compType.includes('bend')) {
          mesh = PipingSpecCatalog3D.generateElbowLR3D({ nps, schedule });
        } else if (compType.includes('flange')) {
          const rating = String(params.rating || params.classRating || '150');
          const flangeType = params.flangeType || 'WN';
          mesh = PipingSpecCatalog3D.generateFlange3D({ nps, rating, flangeType });
        } else if (compType.includes('tee')) {
          mesh = PipingSpecCatalog3D.generateTee3D({ nps, schedule });
        } else {
          const length_mm = Number(params.length_mm || params.length || 1000);
          mesh = PipingSpecCatalog3D.generateStraightSpool3D({ nps, schedule, length_mm });
        }

        return {
          success: true,
          componentType: mesh.type,
          mesh,
          geometry: mesh,
          vertices: mesh.vertices,
          indices: mesh.indices,
          vertexCount: mesh.vertexCount,
          triangleCount: mesh.triangleCount
        };
      } catch (err) {
        return {
          success: false,
          error: { code: 'GEOMETRY_GENERATION_FAILED', message: err.message }
        };
      }
    },
    {
      domain: 'plant',
      description: 'Generate 3D parametric mesh vertices and indices for straight pipes, elbows, flanges, and tees'
    }
  );

  // 21. ASME B31.3 & CAESAR II Piping Stress Engine
  defineHandler(
    'plant:run-caesar-stress-analysis',
    CAESAR_STRESS_ANALYSIS_SCHEMA,
    async (event, params = {}) => {
      try {
        const analysisType = params.analysisType || 'comprehensive';
        const engine = new CaesarPipingStressEngine({
          ambientTempC: params.ambientTempC !== undefined ? params.ambientTempC : 20.0
        });

        const result = {
          success: true,
          status: 'evaluated'
        };

        // 1. API 610 Nozzle analysis
        if (analysisType === 'nozzle' || params.nozzle || (params.Fx !== undefined && params.Fy !== undefined)) {
          const nozzleInput = params.nozzle || {
            nps: params.nps || '4',
            Fx: params.Fx,
            Fy: params.Fy,
            Fz: params.Fz,
            Mx: params.Mx,
            My: params.My,
            Mz: params.Mz
          };
          result.nozzleCheck = engine.checkNozzleLoadsAPI610(nozzleInput);
          if (analysisType === 'nozzle') return result;
        }

        // 2. Spring hanger selection
        if (analysisType === 'spring' || params.support) {
          const supportInput = params.support || {
            operatingLoad_N: params.operatingLoad_N || 10000,
            verticalTravel_mm: params.verticalTravel_mm || 15
          };
          result.springHanger = engine.selectSpringHanger(supportInput);
          if (analysisType === 'spring') return result;
        }

        // 3. ASME B31.3 MAWP
        let mawpResult = null;
        const nps = params.nps || '6';
        const schedule = params.schedule || '40';
        const material = params.material || 'A106-B';
        const tempC =
          params.operatingTempC !== undefined
            ? params.operatingTempC
            : (params.temperature_C !== undefined ? params.temperature_C : 200);

        try {
          mawpResult = PipingSpecCatalog3D.calculateAllowablePressure({
            nps,
            schedule,
            material,
            temperature_C: tempC,
            corrosionAllowance_mm: params.corrosionAllowance_mm !== undefined ? params.corrosionAllowance_mm : 1.5
          });
          result.mawp = mawpResult;
        } catch (_) {
          // If pipe spec not found in catalog, continue with explicit dimensions
        }

        // 4. Expansion loop & Timoshenko flexibility solve
        let Do_m = params.Do_m;
        let t_m = params.t_m;
        if ((!Do_m || !t_m) && nps) {
          try {
            const pipeSpec = PipingSpecCatalog3D.getPipeSpec(nps, schedule);
            Do_m = pipeSpec.outsideDiameter_mm / 1000.0;
            t_m = pipeSpec.wallThickness_mm / 1000.0;
          } catch (_) {
            Do_m = 0.1683;
            t_m = 0.00711;
          }
        }

        const pressure_Pa =
          params.pressure_Pa !== undefined
            ? params.pressure_Pa
            : (params.pressure_bar !== undefined ? params.pressure_bar * 1e5 : 2.0e6);

        const loopParams = {
          runLength_m: params.runLength_m !== undefined ? params.runLength_m : 50.0,
          offset_m: params.offset_m !== undefined ? params.offset_m : 5.0,
          Do_m,
          t_m,
          operatingTempC: tempC,
          pressure_Pa,
          E_Pa: params.E_Pa || 200e9,
          alpha_perC: params.alpha_perC || 1.17e-5,
          Sc_Pa: params.Sc_Pa || (mawpResult ? mawpResult.allowableStress_MPa * 1e6 : 138e6),
          Sh_Pa: params.Sh_Pa || (mawpResult ? mawpResult.allowableStress_MPa * 1e6 : 138e6)
        };

        const loopResult = engine.solveExpansionLoop(loopParams);
        result.expansionStress = loopResult;
        result.thermalExpansion_mm = loopResult.thermalExpansion_mm;
        result.expansionStress_MPa = loopResult.expansionStress_MPa;
        result.allowableExpansion_MPa = loopResult.allowableExpansion_MPa;
        result.sustainedStress_MPa = loopResult.sustainedStress_MPa;
        result.allowableSustained_MPa = loopResult.allowableSustained_MPa;
        result.stressRatio_expansion = loopResult.stressRatio_expansion;
        result.reactionForce_N = loopResult.reactionForce_N;
        result.maxBendingMoment_Nm = loopResult.maxBendingMoment_Nm;
        result.elbowFactors = loopResult.elbowFactors;
        result.codeCompliance = loopResult.codeCompliance;
        result.codeStandard = loopResult.codeStandard;

        return result;
      } catch (err) {
        return {
          success: false,
          error: { code: 'STRESS_ANALYSIS_FAILED', message: err.message }
        };
      }
    },
    {
      domain: 'plant',
      description: 'Evaluate ASME B31.3 MAWP, expansion stress range Se vs Sa, Timoshenko beam flexibility, and API 610 nozzle checks'
    }
  );

  // 22. ISOGEN PCF Document Export
  defineHandler(
    'plant:export-pcf',
    PCF_EXPORT_SCHEMA,
    async (event, params = {}) => {
      try {
        const components = Array.isArray(params) ? params : (params.components || []);
        if (!Array.isArray(components) || components.length === 0) {
          return {
            success: false,
            error: { code: 'INVALID_INPUT', message: 'PCF export requires a non-empty components array' }
          };
        }

        const options = Object.assign({}, params.options || {});
        if (params.pipelineRef) options.pipelineRef = params.pipelineRef;
        if (params.projectName) options.projectName = params.projectName;
        if (options.isogenHeader === undefined) options.isogenHeader = true;

        const pcfText = exportPCF(components, options);
        return {
          success: true,
          pcf: pcfText,
          pcfContent: pcfText,
          componentCount: components.length,
          pipelineRef: options.pipelineRef || 'LINE-1001'
        };
      } catch (err) {
        return {
          success: false,
          error: { code: 'PCF_EXPORT_FAILED', message: err.message }
        };
      }
    },
    {
      domain: 'plant',
      description: 'Export piping component geometry and connectivity to ISOGEN PCF format'
    }
  );
}

module.exports = {
  registerPlantIpc,
  getPlantPropertyCatalogUnavailableResult,
  getVlleFlashUnavailableResult
};
