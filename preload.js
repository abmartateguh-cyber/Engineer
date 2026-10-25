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
  solveNasaRocket: (params) => ipcRenderer.invoke('omni:solve-nasa-rocket', params),
  solveCryogenicLoading: (params) => ipcRenderer.invoke('omni:solve-cryogenic-loading', params),
  simulateAsiIgnition: (params) => ipcRenderer.invoke('omni:simulate-asi-ignition', params),
  getRocketFeatureTree: (params) => ipcRenderer.invoke('omni:get-rocket-feature-tree', params),
  getNasaSpacecraftSpec: (params) => ipcRenderer.invoke('omni:get-nasa-spacecraft-spec', params),

  // Oil & Gas
  solveHYSYSFlash: (params) => ipcRenderer.invoke('omni:solve-hysys-flash', params),
  simulateDistillation: (params) => ipcRenderer.invoke('omni:simulate-distillation', params),
  evaluatePipingStress: (params) => ipcRenderer.invoke('omni:evaluate-piping-stress', params),

  // Universal CAD & Dynamic Systems
  createCadPrimitive: (type, params) => ipcRenderer.invoke('omni:create-cad-primitive', { type, params }),
  // Compatibility contract: block graph signals are dimensionless; tEnd and dt are seconds.
  simulateBlockDiagram: (graphData, tEnd, dt) =>
    ipcRenderer.invoke('omni:simulate-block-diagram', {
      graphData,
      tEnd,
      dt,
      units: {
        tEnd: { unit: 's', dimension: 'time' },
        dt: { unit: 's', dimension: 'time' },
        signal: { unit: '1', dimension: 'dimensionless' },
        stepTime: { unit: 's', dimension: 'time' },
        sourceFrequency: { unit: 'Hz', dimension: 'frequency' },
        gain: { unit: '1', dimension: 'dimensionless' },
        pid: {
          kp: { unit: '1', dimension: 'dimensionless' },
          ki: { unit: 's^-1', dimension: 'frequency' },
          kd: { unit: 's', dimension: 'time' },
          initialState: { unit: 's', dimension: 'time' },
          limits: { unit: '1', dimension: 'dimensionless' }
        },
        layout: { unit: 'px', dimension: 'display-coordinate' }
      }
    }),

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
  computeCuboidMassProperties: (params) => ipcRenderer.invoke('omni:compute-cuboid-mass-properties', params),

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
  getCameraLensMaster: (params) => ipcRenderer.invoke('omni:get-camera-lens-master', params),

  // Industrial Parity CAD & EDA Exporters
  exportSTEP: (bodyData) => ipcRenderer.invoke('omni:export-step', bodyData),
  exportGerber: (pcbData) => ipcRenderer.invoke('omni:export-gerber', pcbData),
  solveSpiceCircuit: (netlist) => ipcRenderer.invoke('omni:solve-spice-circuit', netlist),
  solveFlowsheet: (config) => ipcRenderer.invoke('omni:solve-flowsheet', config),

  // Universal Usability & Phase 1 Archive & Wizard APIs
  packageOmniArchive: (params) => ipcRenderer.invoke('omni:package-omni-archive', params),
  loadOmniArchive: (archiveBytes) => ipcRenderer.invoke('omni:load-omni-archive', archiveBytes),
  runDesignWizard: (wizardType, inputs) => ipcRenderer.invoke('omni:run-design-wizard', { wizardType, inputs }),
  selfHealDesign: (currentDesign, safetyFactor) =>
    ipcRenderer.invoke('omni:self-heal-design', { currentDesign, safetyFactor }),

  // Phase 2 CAD Kernel & Modeling Parity APIs
  evaluateNurbs: (params) => ipcRenderer.invoke('omni:evaluate-nurbs', params),
  intersectBasicNurbs: (params) => ipcRenderer.invoke('omni:intersect-basic-nurbs-ssi', params),
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
  exportGdsii: (params) => ipcRenderer.invoke('omni:export-gdsii', params),
  importGdsii: (buffer) => ipcRenderer.invoke('omni:import-gdsii', buffer),
  evaluateOpticalThermalSoak: (params) => ipcRenderer.invoke('omni:evaluate-optical-thermal-soak', params),
  solveMPC: (params) => ipcRenderer.invoke('omni:solve-mpc', params),

  // Phase 6-13 Master Implementation Plan 2.0 APIs
  intersectNurbsSSI: (params) => ipcRenderer.invoke('omni:intersect-nurbs-ssi', params),
  unfoldSheetMetal: (params) => ipcRenderer.invoke('omni:unfold-sheet-metal', params),
  evaluateGDT: (params) => ipcRenderer.invoke('omni:evaluate-gdt', params),
  solveSparseCholesky: (params) => ipcRenderer.invoke('omni:solve-sparse-cholesky', params),
  computeShellMITC4: (params) => ipcRenderer.invoke('omni:compute-shell-mitc4', params),
  computeBeamTimoshenko: (params) => ipcRenderer.invoke('omni:compute-beam-timoshenko', params),
  evaluateCompositeCLPT: (params) => ipcRenderer.invoke('omni:evaluate-composite-clpt', params),
  stepSimpleCFD: (params) => ipcRenderer.invoke('omni:step-simple-cfd', params),
  runMcmmSTA: (params) => ipcRenderer.invoke('omni:run-mcmm-sta', params),
  extractPex3D: (params) => ipcRenderer.invoke('omni:extract-pex-3d', params),
  evaluateWavefrontPSF: (params) => ipcRenderer.invoke('omni:evaluate-wavefront-psf', params),
  simulateSimscapeDAE: (params) => ipcRenderer.invoke('omni:simulate-simscape-dae', params),
  evaluateMcdcCoverage: (params) => ipcRenderer.invoke('omni:evaluate-mcdc-coverage', params),
  flashPengRobinson: (params) => ipcRenderer.invoke('omni:flash-peng-robinson', params),
  rateTemaHeatExchanger: (params) => ipcRenderer.invoke('omni:rate-tema-heat-exchanger', params),
  sizeApi520PRV: (params) => ipcRenderer.invoke('omni:size-api520-prv', params),
  runFmiCoSimulation: (params) => ipcRenderer.invoke('omni:run-fmi-cosimulation', params),

  // Experimental compatibility API methods
  solveVariationalSketch: (params) => ipcRenderer.invoke('omni:solve-variational-sketch', params),
  healCadGeometry: (params) => ipcRenderer.invoke('omni:heal-cad-geometry', params),
  optimizeOpticalDLS: (params) => ipcRenderer.invoke('omni:optimize-optical-dls', params),
  evaluateASMEVIIIDiv2: (params) => ipcRenderer.invoke('omni:evaluate-asme-viii-div2', params),
  visualDiffCAD: (params) => ipcRenderer.invoke('omni:visual-diff-cad', params),
  rollupEBOM: (params) => ipcRenderer.invoke('omni:rollup-ebom', params),
  computeCadValidationProperties: (params) => ipcRenderer.invoke('omni:compute-cad-validation-properties', params),

  // High-Performance Solvers & Multiphysics Kernels (Pillars 1-2)
  solveWasmSparseMultifrontal: (params) => ipcRenderer.invoke('omni:solve-wasm-sparse-multifrontal', params),
  solveGpuParallelPCG: (params) => ipcRenderer.invoke('omni:solve-gpu-parallel-pcg', params),
  solveWebGPUCFDPoisson: (params) => ipcRenderer.invoke('omni:solve-webgpu-cfd-poisson', params),

  // Experimental compatibility API methods
  securityValidateInput: (params) => ipcRenderer.invoke('omni:security-validate-input', params),
  vaultEncryptProject: (params) => ipcRenderer.invoke('omni:vault-encrypt-project', params),
  vaultDecryptProject: (params) => ipcRenderer.invoke('omni:vault-decrypt-project', params),
  getStandardFastener: (params) => ipcRenderer.invoke('omni:get-standard-fastener', params),
  getOutOfCoreLOD: (params) => ipcRenderer.invoke('omni:get-out-of-core-lod', params),
  auditRecordAction: (params) => ipcRenderer.invoke('omni:audit-record-action', params),
  getKeymapProfiles: (params) => ipcRenderer.invoke('omni:get-keymap-profiles', params),
  getAcceleratorInfo: () => ipcRenderer.invoke('omni:get-accelerator-info'),

  // Flagship Domain Depth & Advanced Compute Host (Phases 2, 5, 6)
  solveContactMechanics3D: (params) => ipcRenderer.invoke('omni:solve-contact-mechanics-3d', params),
  importZmxOptics: (input) => {
    const content = typeof input === 'string' ? input : input?.content;
    return ipcRenderer.invoke('omni:import-zmx-optics', typeof content === 'string' ? { content } : {});
  },
  submitComputeJob: (taskType, payload, options) =>
    ipcRenderer.invoke('omni:submit-compute-job', { taskType, payload, options }),
  cancelComputeJob: (jobId) => ipcRenderer.invoke('omni:cancel-compute-job', { jobId }),
  getComputeTelemetry: () => ipcRenderer.invoke('omni:get-compute-telemetry'),
  runVVBenchmarks: (options) => ipcRenderer.invoke('omni:run-vv-benchmarks', options),

  // Experimental compatibility API methods
  cadExtrudeProfile: (params) => ipcRenderer.invoke('omni:cad-extrude-profile', params),
  cadRevolveProfile: (params) => ipcRenderer.invoke('omni:cad-revolve-profile', params),
  cadShellBody: (params) => ipcRenderer.invoke('omni:cad-shell-body', params),
  camGenerateToolpath: (params) => ipcRenderer.invoke('omni:cam-generate-toolpath', params),
  caeNonlinearLargeDeflection: (params) => ipcRenderer.invoke('omni:cae-nonlinear-large-deflection', params),
  edaPlaceAndRoute: (params) => ipcRenderer.invoke('omni:eda-place-and-route', params),
  plantNrtlActivity: (params) => ipcRenderer.invoke('omni:plant-nrtl-activity', params),

  // Phase 1-3 Advanced CAE & High-Performance Simulation APIs
  meshHybridPrismTet: (params) => ipcRenderer.invoke('omni:mesh-hybrid-prism-tet', params),
  solveTransonicRiemann: (params) => ipcRenderer.invoke('omni:solve-transonic-riemann', params),
  solveFeaHEX20: (params) => ipcRenderer.invoke('omni:solve-fea-hex20', params),
  solvePenaltyContact: (params) => ipcRenderer.invoke('omni:solve-penalty-contact', params),

  // Phase 4-6 Open Silicon EDA & Polarization Optics APIs
  edaSky130Pdk: (params) => ipcRenderer.invoke('omni:eda-sky130-pdk', params),
  edaParseLef: (params) => ipcRenderer.invoke('omni:eda-parse-lef', params),
  edaParseDef: (params) => ipcRenderer.invoke('omni:eda-parse-def', params),
  edaSerializeDef: (params) => ipcRenderer.invoke('omni:eda-serialize-def', params),
  tracePolarizationRay: (params) => ipcRenderer.invoke('omni:trace-polarization-ray', params),
  queryGlassCatalog: (params) => ipcRenderer.invoke('omni:query-glass-catalog', params),
  runOpticalTolerancing: (params) => ipcRenderer.invoke('omni:run-optical-tolerancing', params),

  // Phase 7-10 Chemical eNRTL, AUTOSAR, Hardware Security & Headless HPC APIs
  evaluateEnrtlCO2: (params) => ipcRenderer.invoke('omni:evaluate-enrtl-co2', params),
  generateAutosarSWC: (params) => ipcRenderer.invoke('omni:generate-autosar-swc', params),
  pkcs11SignPayload: (params) => ipcRenderer.invoke('omni:pkcs11-sign-payload', params),
  pkcs11VerifySignature: (params) => ipcRenderer.invoke('omni:pkcs11-verify-signature', params),
  iamEvaluateAccess: (params) => ipcRenderer.invoke('omni:iam-evaluate-access', params),
  generateSBOM: (params) => ipcRenderer.invoke('omni:generate-sbom', params),
  meshDomainDecomposition: (params) => ipcRenderer.invoke('omni:mesh-domain-decomposition', params),
  run100GoldBenchmarks: () => ipcRenderer.invoke('omni:run-100-gold-benchmarks'),

  // System & Environment
  getFeatureMaturity: () => ipcRenderer.invoke('omni:get-feature-maturity'),
  getSystemInfo: () => ipcRenderer.invoke('omni:get-system-info')
});
