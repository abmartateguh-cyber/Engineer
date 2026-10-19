/**
 * OmniEng Plant & Chemical Process Domain IPC Router & Schema Definitions
 * Covers Thermodynamics, Flash, Distillation, ASME B31.3 Piping, PFD Flowsheet, DIPPR, TEMA, API 520
 */

'use strict';

const { defineHandler } = require('./define_handler');
const { ThermodynamicsEngine } = require('../../core/plant/thermodynamics');
const { PipingStressEngine } = require('../../core/plant/piping_stress');
const { VLEPhaseEnvelopeEngine } = require('../../core/plant/vle_envelope');
const { ProcessStream, ProcessFlowsheetSolver } = require('../../core/plant/process_flowsheet_solver');
const { DIPPRDatabase } = require('../../core/plant/dippr_database');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('../../core/plant/naphtali_sandholm_mesh');
const { PengRobinsonEOS } = require('../../core/plant/peng_robinson_eos');
const { TemaBellDelaware } = require('../../core/plant/tema_bell_delaware');
const { Api520ReliefValve } = require('../../core/plant/api520_relief_valve');

function registerPlantIpc(deps = {}) {
  const dipprDatabase = deps.dipprDatabase || new DIPPRDatabase();

  // 1. HYSYS VLE Flash
  defineHandler('omni:solve-hysys-flash', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { feedComposition = { Methane: 0.2, Propane: 0.5, nPentane: 0.3 }, tempC = 25, pressureBar = 5 } = params;
    return ThermodynamicsEngine.flashVLE(feedComposition, tempC, pressureBar);
  }, { domain: 'plant', description: 'Solve cubic equation of state VLE vapor-liquid flash' });

  // 2. Distillation Column Simulation
  defineHandler('omni:simulate-distillation', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const { feedBPD = 50000, trayCount = 30, refluxRatio = 2.5 } = params;
    return ThermodynamicsEngine.simulateDistillationColumn(feedBPD, trayCount, refluxRatio);
  }, { domain: 'plant', description: 'Simulate multi-tray hydrocarbon fractionation column' });

  // 3. ASME B31.3 Piping Stress
  defineHandler('omni:evaluate-piping-stress', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    return PipingStressEngine.evaluateASMEB313(params);
  }, { domain: 'plant', description: 'Evaluate thermal expansion and sustained stress per ASME B31.3' });

  // 4. VLE P-T Phase Envelope
  defineHandler('omni:get-vle-envelope', {
    type: 'object',
    optional: true
  }, async (event, { composition, pMinBar, pMaxBar, points } = {}) => {
    return VLEPhaseEnvelopeEngine.generatePTEnvelope(composition, pMinBar, pMaxBar, points);
  }, { domain: 'plant', description: 'Generate bubble point, dew point, and cricondenbar P-T curves' });

  // 5. Column Tray Profile
  defineHandler('omni:get-column-profile', {
    type: 'object',
    optional: true
  }, async (event, { trayCount, feedTray, feedBPD } = {}) => {
    return VLEPhaseEnvelopeEngine.generateColumnTrayProfile(trayCount, feedTray, feedBPD);
  }, { domain: 'plant', description: 'Compute temperature and liquid/vapor compositions along column trays' });

  // 6. Cyclic Process Flowsheet (PFD)
  defineHandler('omni:solve-flowsheet', {
    type: 'object',
    optional: true
  }, async (event, config = {}) => {
    const flowsheet = new ProcessFlowsheetSolver();
    const feed = new ProcessStream('S1', {
      temperatureC: 25.0,
      pressureBar: 20.0,
      molarFlowKmolHr: 100.0,
      composition: { Methane: 0.7, Ethane: 0.2, Propane: 0.1 }
    });
    flowsheet.addStream(feed);
    flowsheet.addMixer('MIX1', ['S1', 'S_RECYCLE'], 'S2');
    flowsheet.addFlashDrum('FLASH1', 'S2', 'S_VAPOR', 'S_LIQ', { temperatureC: -20.0, pressureBar: 18.0 });
    flowsheet.addSplitter('SPLIT1', 'S_LIQ', 'S_PRODUCT', 'S_RECYCLE', { splitRatio: 0.7 });
    const solution = flowsheet.solveWithWegstein(50, 1e-4);
    return { success: true, solution };
  }, { domain: 'plant', description: 'Solve process flowsheet with Wegstein recycle tear stream acceleration' });

  // 7. DIPPR Pure Component Database Query
  defineHandler('omni:query-dippr-database', {
    optional: true
  }, async (event, query) => {
    const comp = dipprDatabase.get(query);
    if (!comp) return { success: false, error: 'Component not found' };
    return {
      success: true,
      component: {
        id: comp.id,
        name: comp.name,
        formula: comp.formula,
        family: comp.family,
        mw: comp.mw,
        Tc: comp.Tc,
        Pc: comp.Pc,
        Tb: comp.Tb,
        Pvap298Pa: comp.getVaporPressure(298.15),
        rhoL298KgM3: comp.getLiquidDensity(298.15),
        Cp0300: comp.getIdealGasCp(300.0)
      }
    };
  }, { domain: 'plant', description: 'Query 1,200+ pure components from AIChE DIPPR 801 database' });

  // 8. 3-Phase VLLE Flash
  defineHandler('omni:solve-vlle-flash', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const res = dipprDatabase.solveVLLEFlash(params.spec || {
      components: ['Water', 'n-Hexane', 'Nitrogen'],
      feedFractions: [0.45, 0.45, 0.10],
      temperatureK: 340.0,
      pressurePa: 1.2e5
    });
    return { success: true, result: res };
  }, { domain: 'plant', description: 'Solve simultaneous 3-phase vapor-liquid-liquid equilibrium flash' });

  // 9. Naphtali-Sandholm Simultaneous MESH Distillation
  defineHandler('omni:solve-mesh-distillation', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const res = NaphtaliSandholmColumnSolver.solve(params.spec || {
      stages: 15,
      feedStage: 8,
      components: ['Propane', 'n-Butane', 'n-Pentane'],
      feedFlows: [15.0, 20.0, 15.0],
      feedTemperatureK: 330.0,
      pressurePa: 1.01325e5,
      refluxRatio: 2.5,
      distillateRate: 25.0
    });
    return { success: true, result: res };
  }, { domain: 'plant', description: 'Solve rigorous block-tridiagonal MESH equations via Newton-Raphson' });

  // 10. Water Hammer Method of Characteristics (MOC)
  defineHandler('omni:solve-water-hammer-moc', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const res = WaterHammerMOC.simulateMOC(params.options || {
      pipeLengthM: 400.0,
      initialVelocityMs: 2.5,
      initialPressurePa: 4.0e5,
      closureTimeSec: 0.15,
      frictionFactor: 0.02,
      totalTimeSec: 1.5
    });
    return { success: true, result: res };
  }, { domain: 'plant', description: 'Simulate transient hydraulic surge waves and water hammer pressure peaks' });

  // 11. Peng-Robinson 1978 EOS Flash
  defineHandler('omni:flash-peng-robinson', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const eos = new PengRobinsonEOS(params.components || ['methane', 'ethane', 'propane']);
    const flash = eos.flashPT(params.z || [0.5, 0.3, 0.2], params.T || 200.0, params.P || 2000000.0);
    return { success: true, flash };
  }, { domain: 'plant', description: 'Rigorous PR-78 cubic equation of state with Rachford-Rice solver' });

  // 12. TEMA Shell & Tube Heat Exchanger Rating
  defineHandler('omni:rate-tema-heat-exchanger', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const tema = new TemaBellDelaware(params.geom || {
      Ds: 0.60, do: 0.020, Pt: 0.025, pitchAngle: 30, L: 4.0, B: 0.30, Bc: 0.20, Nt: 350
    });
    const rating = tema.rateShellSide(params.fluid || {
      massFlow: 15.0, rho: 850.0, mu: 0.002, Cp: 2100.0, k: 0.14
    });
    return { success: true, rating };
  }, { domain: 'plant', description: 'Bell-Delaware shell-side heat transfer coefficient and pressure drop rating' });

  // 13. API 520 / API 526 Pressure Relief Valve (PRV) Sizing
  defineHandler('omni:size-api520-prv', {
    type: 'object',
    optional: true
  }, async (event, params = {}) => {
    const sizing = Api520ReliefValve.sizeGasVapor(params || {
      massFlow: 5000, P1: 1100, Pb: 101.325, T: 320, M: 28.97, k: 1.40
    });
    return { success: true, sizing };
  }, { domain: 'plant', description: 'Compute required relief area and select standard API 526 orifice designation' });
}

module.exports = { registerPlantIpc };
