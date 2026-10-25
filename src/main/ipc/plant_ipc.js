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
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../../core/plant/naphtali_sandholm_mesh');
const { PengRobinsonEOS } = require('../../core/plant/peng_robinson_eos');
const { TemaBellDelaware } = require('../../core/plant/tema_bell_delaware');
const { Api520ReliefValve } = require('../../core/plant/api520_relief_valve');

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
    async (event, { composition, pMinBar, pMaxBar, points, componentProperties } = {}) => {
      if (
        [composition, pMinBar, pMaxBar, points, componentProperties].some(
          (value) => value === undefined || value === null
        )
      ) {
        return unavailable('Required inputs missing: composition, componentProperties, pMinBar, pMaxBar, points');
      }
      return VLEPhaseEnvelopeEngine.generatePTEnvelope(composition, pMinBar, pMaxBar, points, componentProperties);
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
    async (event, params = {}) => {
      if (!params.spec) return unavailable('A complete column specification is required.');
      const res = NaphtaliSandholmColumnSolver.solve(params.spec);
      return { success: true, validationLevel: 'experimental', result: res };
    },
    { domain: 'plant', description: 'Run an experimental MESH column calculation from explicit inputs' }
  );

  // 10. Water Hammer Method of Characteristics (MOC)
  defineHandler(
    'omni:solve-water-hammer-moc',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      if (!params.options) return unavailable('Explicit water-hammer simulation options are required.');
      const res = WaterHammerMOC.simulateMOC(params.options);
      return { success: true, validationLevel: 'experimental', result: res };
    },
    { domain: 'plant', description: 'Run an experimental water-hammer estimate from explicit inputs' }
  );

  // 11. Peng-Robinson 1978 EOS Flash
  defineHandler(
    'omni:flash-peng-robinson',
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      const missing = requireFields(params, ['components', 'z', 'T', 'P']);
      if (missing.length) return unavailable(`Required inputs missing: ${missing.join(', ')}`);
      const eos = new PengRobinsonEOS(params.components);
      const flash = eos.flashPT(params.z, params.T, params.P);
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
    {
      type: 'object',
      optional: true
    },
    async (event, params = {}) => {
      return unavailable(
        'This route currently embeds unsourced binary parameters and hard-coded ethanol-water assumptions.'
      );
    },
    { domain: 'plant', description: 'Unavailable pending sourced component parameters and explicit mixture identity' }
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
}

module.exports = {
  registerPlantIpc,
  getPlantPropertyCatalogUnavailableResult,
  getVlleFlashUnavailableResult
};
