/**
 * OmniEng Electron Preload Script
 * Securely exposes the OmniEng API to the renderer process via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omniEngAPI', {
  // Consumer Electronics
  solveDropTest: (params) => ipcRenderer.invoke('omni:solve-drop-test', params),
  solveThermal: (params) => ipcRenderer.invoke('omni:solve-thermal', params),

  // Semiconductor & EDA
  synthesizeVerilog: (source) => ipcRenderer.invoke('omni:synthesize-verilog', source),
  runDRC: (shapes, rules) => ipcRenderer.invoke('omni:run-drc', { shapes, rules }),
  runLVS: (schematic, layout) => ipcRenderer.invoke('omni:run-lvs', { schematic, layout }),

  // Drone & Aerospace
  solveCFD: (params) => ipcRenderer.invoke('omni:solve-cfd', params),
  solvePropellerThrust: (params) => ipcRenderer.invoke('omni:solve-propeller', params),
  simulateDrone: (params) => ipcRenderer.invoke('omni:simulate-drone', params),

  // Oil & Gas
  solveHYSYSFlash: (params) => ipcRenderer.invoke('omni:solve-hysys-flash', params),
  simulateDistillation: (params) => ipcRenderer.invoke('omni:simulate-distillation', params),
  evaluatePipingStress: (params) => ipcRenderer.invoke('omni:evaluate-piping-stress', params),

  // Universal CAD & Dynamic Systems
  createCadPrimitive: (type, params) => ipcRenderer.invoke('omni:create-cad-primitive', { type, params }),
  simulateBlockDiagram: (graphData, tEnd, dt) => ipcRenderer.invoke('omni:simulate-block-diagram', { graphData, tEnd, dt }),

  // OmniAI Co-Pilot & Extensibility
  processAIPrompt: (prompt, context) => ipcRenderer.invoke('omni:ai-process-prompt', { prompt, context }),

  // Community Samples & Project Data
  getCommunitySamples: () => ipcRenderer.invoke('omni:get-community-samples'),
  exportCADOBJ: (bodyData) => ipcRenderer.invoke('omni:export-cad-obj', bodyData),

  // Cloud-Native HPC Cluster
  getClusterStatus: () => ipcRenderer.invoke('omni:get-cluster-status'),
  setMembership: (active) => ipcRenderer.invoke('omni:set-membership', active),
  submitHPCJob: (jobType, params, ranks) => ipcRenderer.invoke('omni:submit-hpc-job', { jobType, params, ranks }),

  // Engineering Verification & Audit Report
  generateAuditReport: (context) => ipcRenderer.invoke('omni:generate-audit-report', context),

  // Engineering Materials Database
  getMaterialsList: () => ipcRenderer.invoke('omni:get-materials-list'),
  computeInertia: (params) => ipcRenderer.invoke('omni:compute-inertia', params),

  // Advanced Transient Dynamics & Frequency Analysis
  solveTransientDrop: (params) => ipcRenderer.invoke('omni:solve-transient-drop', params),
  solveBode: (params) => ipcRenderer.invoke('omni:solve-bode', params),

  // Advanced Chemical Process Thermodynamics
  getVLEEnvelope: (params) => ipcRenderer.invoke('omni:get-vle-envelope', params),
  getColumnProfile: (params) => ipcRenderer.invoke('omni:get-column-profile', params),

  // Camera Lens Optics & Optomechanics
  solveOptics: (params) => ipcRenderer.invoke('omni:solve-optics', params),
  traceRays: (params) => ipcRenderer.invoke('omni:trace-rays', params),
  getLensPrescription: () => ipcRenderer.invoke('omni:get-lens-prescription'),

  // System & Environment
  getSystemInfo: () => ipcRenderer.invoke('omni:get-system-info')
});
