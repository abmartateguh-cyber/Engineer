/**
 * OmniEng Main Process (Electron Application)
 * Connects high-performance native simulation engines, local file systems, and IPC bridges.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');

// Core Engines
const { BRepPrimitives } = require('./src/core/cad/brep_topology');
const { FeatureTree, ParametricFeature } = require('./src/core/cad/feature_tree');
const { DropTestSimulator } = require('./src/core/cae/drop_test');
const { CFDSolver2D } = require('./src/core/cae/cfd_navier_stokes');
const { ThermalEngine } = require('./src/core/cae/thermal_cht');
const { LogicSynthesisEngine } = require('./src/core/eda/logic_synthesis');
const { DRCEngine } = require('./src/core/eda/drc_engine');
const { BlockDiagramGraph } = require('./src/core/dynamic_simulink/block_graph');
const { QuadcopterDynamics } = require('./src/core/dynamic_simulink/drone_flight_dynamics');
const { ThermodynamicsEngine } = require('./src/core/plant/thermodynamics');
const { PipingStressEngine } = require('./src/core/plant/piping_stress');
const { OmniAIEngine } = require('./src/core/ai/omni_ai_engine');
const { CloudHPCEngine } = require('./src/core/hpc/cloud_cluster');
const { AuditReportGenerator } = require('./src/core/reporting/audit_report');
const { MaterialManager } = require('./src/core/materials/material_database');
const { TransientDropAnimator } = require('./src/core/cae/transient_drop_animator');
const { FrequencyResponseAnalyzer } = require('./src/core/dynamic_simulink/frequency_analysis');
const { VLEPhaseEnvelopeEngine } = require('./src/core/plant/vle_envelope');
const { OpticalEngine } = require('./src/core/optics/optical_engine');
const { COMMUNITY_SAMPLES } = require('./src/samples/community_samples');

const aiEngine = new OmniAIEngine();
const hpcEngine = new CloudHPCEngine();

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'OmniEng — Universal Engineering & Simulation Platform',
    backgroundColor: '#090d16',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableWebSQL: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  // Register All IPC Handlers

  // 1. Consumer Electronics: Drop Test & Thermal CHT
  ipcMain.handle('omni:solve-drop-test', async (event, params) => {
    return DropTestSimulator.runSimulation(params);
  });

  ipcMain.handle('omni:solve-thermal', async (event, params) => {
    return ThermalEngine.simulateSmartphoneThermal(params);
  });

  // 2. Semiconductor & EDA: Synthesis, DRC & LVS
  ipcMain.handle('omni:synthesize-verilog', async (event, source) => {
    return LogicSynthesisEngine.synthesize(source);
  });

  ipcMain.handle('omni:run-drc', async (event, { shapes, rules }) => {
    return DRCEngine.runDRC(shapes, rules);
  });

  ipcMain.handle('omni:run-lvs', async (event, { schematic, layout }) => {
    return DRCEngine.runLVS(schematic, layout);
  });

  // 3. Drone & Aerospace: CFD & Flight Dynamics
  ipcMain.handle('omni:solve-cfd', async (event, params = {}) => {
    const { nx = 40, ny = 30, aoaDeg = 4.0, velocity = 15.0 } = params;
    const cfd = new CFDSolver2D(nx, ny);
    cfd.setAirfoilObstacle(0.4, 0.12, aoaDeg);
    return cfd.solve(velocity, 120);
  });

  ipcMain.handle('omni:solve-propeller', async (event, params = {}) => {
    const { rpm = 8000, diameterInches = 5.0, pitchInches = 3.0 } = params;
    return CFDSolver2D.solvePropellerThrust(rpm, diameterInches, pitchInches);
  });

  ipcMain.handle('omni:simulate-drone', async (event, params) => {
    return QuadcopterDynamics.simulateFlightMission(params);
  });

  // 4. Oil & Gas Process: Thermodynamics & Piping Stress
  ipcMain.handle('omni:solve-hysys-flash', async (event, params = {}) => {
    const { feedComposition = { Methane: 0.2, Propane: 0.5, nPentane: 0.3 }, tempC = 25, pressureBar = 5 } = params;
    return ThermodynamicsEngine.flashVLE(feedComposition, tempC, pressureBar);
  });

  ipcMain.handle('omni:simulate-distillation', async (event, params = {}) => {
    const { feedBPD = 50000, trayCount = 30, refluxRatio = 2.5 } = params;
    return ThermodynamicsEngine.simulateDistillationColumn(feedBPD, trayCount, refluxRatio);
  });

  ipcMain.handle('omni:evaluate-piping-stress', async (event, params) => {
    return PipingStressEngine.evaluateASMEB313(params);
  });

  // 5. Universal CAD & Dynamic Systems
  ipcMain.handle('omni:create-cad-primitive', async (event, { type, params }) => {
    let body;
    if (type === 'cylinder') {
      body = BRepPrimitives.createCylinder(params.radius || 15, params.height || 40);
    } else if (type === 'sphere') {
      body = BRepPrimitives.createSphere(params.radius || 20);
    } else {
      body = BRepPrimitives.createBox(params.width || 60, params.height || 40, params.depth || 80);
    }
    return {
      id: body.id,
      name: body.name,
      volume: body.computeVolume(),
      triangles: body.toTriangles(),
      bbox: body.getBoundingBox()
    };
  });

  ipcMain.handle('omni:simulate-block-diagram', async (event, { graphData, tEnd, dt }) => {
    const graph = BlockDiagramGraph.fromJSON(graphData);
    return graph.simulate(tEnd || 10.0, dt || 0.01);
  });

  // 6. OmniAI Assistant
  ipcMain.handle('omni:ai-process-prompt', async (event, { prompt, context }) => {
    return aiEngine.processPrompt(prompt, context);
  });

  // 7. Community Samples & Export
  ipcMain.handle('omni:get-community-samples', async () => {
    return COMMUNITY_SAMPLES;
  });

  ipcMain.handle('omni:export-cad-obj', async (event, bodyData) => {
    const body = BRepPrimitives.createBox(bodyData.width || 50, bodyData.height || 30, bodyData.depth || 80);
    return body.toOBJ();
  });

  ipcMain.handle('omni:get-system-info', async () => {
    return {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / (1024 ** 3)),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      tier: 'Local Workstation (Air-Gapped)'
    };
  });

  // 8. Cloud-Native HPC Cluster (Membership Tier)
  ipcMain.handle('omni:get-cluster-status', async () => {
    return hpcEngine.getClusterStatus();
  });

  ipcMain.handle('omni:set-membership', async (event, active) => {
    return hpcEngine.setMembership(active);
  });

  ipcMain.handle('omni:submit-hpc-job', async (event, { jobType, params, ranks }) => {
    return hpcEngine.submitSimulationJob(jobType, params, ranks);
  });

  // 9. Comprehensive Engineering Audit & Technical Report
  ipcMain.handle('omni:generate-audit-report', async (event, context) => {
    return AuditReportGenerator.generateComprehensiveReport(context);
  });

  // 10. Engineering Materials Database
  ipcMain.handle('omni:get-materials-list', async () => {
    return MaterialManager.listAllMaterials();
  });

  ipcMain.handle('omni:compute-inertia', async (event, { matKey, widthM, heightM, depthM }) => {
    return MaterialManager.computeInertiaCuboid(matKey, widthM, heightM, depthM);
  });

  // 11. Advanced Transient Dynamics & Frequency Analysis
  ipcMain.handle('omni:solve-transient-drop', async (event, params) => {
    return TransientDropAnimator.solveTransientHistory(params);
  });

  ipcMain.handle('omni:solve-bode', async (event, { numCoeffs, denCoeffs, omegaMin, omegaMax, points }) => {
    return FrequencyResponseAnalyzer.computeBode(numCoeffs, denCoeffs, omegaMin, omegaMax, points);
  });

  // 12. Advanced Chemical Process Thermodynamics
  ipcMain.handle('omni:get-vle-envelope', async (event, { composition, pMinBar, pMaxBar, points }) => {
    return VLEPhaseEnvelopeEngine.generatePTEnvelope(composition, pMinBar, pMaxBar, points);
  });

  ipcMain.handle('omni:get-column-profile', async (event, { trayCount, feedTray, feedBPD }) => {
    return VLEPhaseEnvelopeEngine.generateColumnTrayProfile(trayCount, feedTray, feedBPD);
  });

  // 13. Camera Lens Optics & Optomechanics
  ipcMain.handle('omni:solve-optics', async (event, params = {}) => {
    const { focalLengthMm = 50.0, fStop = 1.4, subjectDistM = 2.0 } = params;
    return OpticalEngine.solveOpticalMetrics(focalLengthMm, fStop, subjectDistM);
  });

  ipcMain.handle('omni:trace-rays', async (event, params = {}) => {
    const { fStop = 1.4, rayCount = 9 } = params;
    return OpticalEngine.traceRays(fStop, rayCount);
  });

  ipcMain.handle('omni:get-lens-prescription', async () => {
    return OpticalEngine.get50mmPrescription();
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
