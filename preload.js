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
  solveSkewOptics: (params) => ipcRenderer.invoke('omni:solve-skew-optics', params),

  // Industrial Parity CAD & EDA Exporters
  exportSTEP: (bodyData) => ipcRenderer.invoke('omni:export-step', bodyData),
  exportGerber: (pcbData) => ipcRenderer.invoke('omni:export-gerber', pcbData),
  solveSpiceCircuit: (netlist) => ipcRenderer.invoke('omni:solve-spice-circuit', netlist),
  solveFlowsheet: (config) => ipcRenderer.invoke('omni:solve-flowsheet', config),

  // Universal Usability & Phase 1 Archive & Wizard APIs
  packageOmniArchive: (params) => ipcRenderer.invoke('omni:package-omni-archive', params),
  loadOmniArchive: (filePath) => ipcRenderer.invoke('omni:load-omni-archive', filePath),
  runDesignWizard: (wizardType, inputs) => ipcRenderer.invoke('omni:run-design-wizard', { wizardType, inputs }),
  selfHealDesign: (currentDesign, safetyFactor) => ipcRenderer.invoke('omni:self-heal-design', { currentDesign, safetyFactor }),

  // Phase 2 CAD Kernel & Modeling Parity APIs
  evaluateNurbs: (params) => ipcRenderer.invoke('omni:evaluate-nurbs', params),
  intersectNurbsSSI: (params) => ipcRenderer.invoke('omni:intersect-nurbs-ssi', params),
  applyEdgeBlend: (params) => ipcRenderer.invoke('omni:apply-edge-blend', params),
  solveAssemblyMates: (params) => ipcRenderer.invoke('omni:solve-assembly-mates', params),
  generateDraftingSheet: (params) => ipcRenderer.invoke('omni:generate-drafting-sheet', params),

  // Phase 3 Structural Mechanics & Fluid Multiphysics APIs
  meshDelaunay3D: (params) => ipcRenderer.invoke('omni:mesh-delaunay-3d', params),
  solveContinuumPlasticity3D: (params) => ipcRenderer.invoke('omni:solve-continuum-plasticity-3d', params),
  solveFvmCFD3D: (params) => ipcRenderer.invoke('omni:solve-fvm-cfd-3d', params),

  // Phase 4 Semiconductor EDA & High-Order Optics APIs
  evaluateAsphericOptics: (params) => ipcRenderer.invoke('omni:evaluate-aspheric-optics', params),
  evaluateThinFilmCoating: (params) => ipcRenderer.invoke('omni:evaluate-thin-film-coating', params),
  synthesizeSystemVerilog: (params) => ipcRenderer.invoke('omni:synthesize-system-verilog', params),
  synthesizeClockTree: (params) => ipcRenderer.invoke('omni:synthesize-clock-tree', params),
  solveBsim4Vtc: (params) => ipcRenderer.invoke('omni:solve-bsim4-vtc', params),

  // Phase 5 GNC Autopilot, Chemical Process & Industrial Parity APIs
  scheduleMultiRate: (params) => ipcRenderer.invoke('omni:schedule-multi-rate', params),
  solveAlgebraicLoop: (params) => ipcRenderer.invoke('omni:solve-algebraic-loop', params),
  synthesizeLQR: (params) => ipcRenderer.invoke('omni:synthesize-lqr', params),
  autocodeController: (params) => ipcRenderer.invoke('omni:autocode-controller', params),
  queryDipprDatabase: (query) => ipcRenderer.invoke('omni:query-dippr-database', query),
  solveVlleFlash: (params) => ipcRenderer.invoke('omni:solve-vlle-flash', params),
  solveMeshDistillation: (params) => ipcRenderer.invoke('omni:solve-mesh-distillation', params),
  solveWaterHammerMOC: (params) => ipcRenderer.invoke('omni:solve-water-hammer-moc', params),

  // System & Environment
  getSystemInfo: () => ipcRenderer.invoke('omni:get-system-info')
});
