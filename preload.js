/**
 * OmniEng Electron Preload Script
 * Securely exposes the OmniEng API to the renderer process via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

const DEFAULT_BLOCK_DIAGRAM_UNITS = Object.freeze({
  tEnd: Object.freeze({ unit: 's', dimension: 'time' }),
  dt: Object.freeze({ unit: 's', dimension: 'time' }),
  signal: Object.freeze({ unit: '1', dimension: 'dimensionless' }),
  stepTime: Object.freeze({ unit: 's', dimension: 'time' }),
  sourceFrequency: Object.freeze({ unit: 'Hz', dimension: 'frequency' }),
  gain: Object.freeze({ unit: '1', dimension: 'dimensionless' }),
  pid: Object.freeze({
    kp: Object.freeze({ unit: '1', dimension: 'dimensionless' }),
    ki: Object.freeze({ unit: 's^-1', dimension: 'frequency' }),
    kd: Object.freeze({ unit: 's', dimension: 'time' }),
    initialState: Object.freeze({ unit: 's', dimension: 'time' }),
    limits: Object.freeze({ unit: '1', dimension: 'dimensionless' })
  }),
  layout: Object.freeze({ unit: 'px', dimension: 'display-coordinate' })
});

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
      units: DEFAULT_BLOCK_DIAGRAM_UNITS
    }),

  // OmniAI Co-Pilot & Extensibility
  processAIPrompt: (prompt, context) => ipcRenderer.invoke('omni:ai-process-prompt', { prompt, context }),
  aiTrainSurrogate: (payload) => ipcRenderer.invoke('omni:ai-train-surrogate', payload),
  aiPredictSurrogate: (payload) => ipcRenderer.invoke('omni:ai-predict-surrogate', payload),

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
  materialsCatalogQuery: (params) => ipcRenderer.invoke('omni:materials-catalog-query', params),
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

  // Experimental CAD, EDA and process IPC methods
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

  // Phase 1 Project Lifecycle, Atomic Persistence & Undo/Redo
  newProject: (params) => ipcRenderer.invoke('omni:new-project', params),
  saveProject: (params) => ipcRenderer.invoke('omni:save-project', params),
  openProject: (params) => ipcRenderer.invoke('omni:open-project', params),
  undoProjectCommand: () => ipcRenderer.invoke('omni:undo'),
  redoProjectCommand: () => ipcRenderer.invoke('omni:redo'),
  getProjectHistory: () => ipcRenderer.invoke('omni:get-project-history'),
  recordProjectCommand: (params) => ipcRenderer.invoke('omni:record-project-command', params),
  getProjectSummary: () => ipcRenderer.invoke('omni:get-project-summary'),

  // Experimental CAD geometry and modeling APIs
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

  // Experimental controls, chemical-process and industrial APIs
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
  solveGenericSparse: (params) => ipcRenderer.invoke('omni:solve-generic-sparse', params),
  solveRadauIIA: (params) => ipcRenderer.invoke('omni:solve-radau-iia', params),
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

  // Experimental WASM, GPU and WebGPU solver APIs
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

  // Experimental CAE simulation APIs
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
  opticsGlassLookup: (params) => ipcRenderer.invoke('omni:optics-glass-lookup', params),
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
  getSystemInfo: () => ipcRenderer.invoke('omni:get-system-info'),

  // Stenographer Supervisor, CAS Blobs, IAPWS-IF97 Steam, Robotics & Aerospace
  stenographerQuery: (payload) => ipcRenderer.invoke('omni:stenographer-query', payload),
  stenographerGetTools: () => ipcRenderer.invoke('omni:stenographer-get-tools'),
  stenographerGetProposals: () => ipcRenderer.invoke('omni:stenographer-get-proposals'),
  stenographerEvaluateProposal: (payload) => ipcRenderer.invoke('omni:stenographer-evaluate-proposal', payload),
  stenographerExecuteTool: (payload) => ipcRenderer.invoke('omni:stenographer-execute-tool', payload),
  stenographerVerifyLedger: () => ipcRenderer.invoke('omni:stenographer-verify-ledger'),
  addBlob: (payload) => ipcRenderer.invoke('omni:add-blob', payload),
  getBlob: (payload) => ipcRenderer.invoke('omni:get-blob', payload),
  listBlobs: () => ipcRenderer.invoke('omni:list-blobs'),
  calculateSteamProperties: (payload) => ipcRenderer.invoke('omni:calculate-steam-properties', payload),
  // P&ID generation
  generatePID: (params) => ipcRenderer.invoke('omni:generate-p-id', params),
  runRoboticsOperation: (payload) => ipcRenderer.invoke('omni:run-robotics-operation', payload),
  compileRocketNozzle: (params) => ipcRenderer.invoke('omni:compile-rocket-nozzle', params),
  runAerospaceCFD: (params) => ipcRenderer.invoke('omni:run-aerospace-cfd', params),
  calculateOrbitalTransfer: (params) => ipcRenderer.invoke('omni:calculate-orbital-transfer', params),

  // Industrial capability probes: explicit route aliases used by renderer
  // call sites so each matrix capability has a verified end-to-end surface.
  solveStateSpaceLTI: (params) => ipcRenderer.invoke('omni:solve-state-space-lti', params),
  estimateEKF: (params) => ipcRenderer.invoke('omni:estimate-ekf', params),
  validateLifecycle: (params) => ipcRenderer.invoke('omni:validate-lifecycle', params),
  hpcExecuteLocalParallel: (params) => ipcRenderer.invoke('omni:hpc-execute-local-parallel', params),
  hpcPlanOutOfCore: (params) => ipcRenderer.invoke('omni:hpc-plan-out-of-core', params),
  hpcLocalDispatch: (params) => ipcRenderer.invoke('omni:hpc-local-dispatch', params),
  solveSparseOrdering: (params) => ipcRenderer.invoke('omni:solve-sparse-ordering', params),
  solvePcgDense: (params) => ipcRenderer.invoke('omni:solve-pcg-dense', params),
  hashArtifactSha256: (params) => ipcRenderer.invoke('omni:hash-artifact-sha256', params),
  evaluateSignalIntegrityPower: (params) => ipcRenderer.invoke('omni:evaluate-signal-integrity-power', params),
  generateMaturityReport: (params) => ipcRenderer.invoke('omni:generate-maturity-report', params),
  solveFEA: (params) => ipcRenderer.invoke('omni:solve-fea-hex20', params),
  verifyLedger: () => ipcRenderer.invoke('omni:stenographer-verify-ledger'),
  getProposals: () => ipcRenderer.invoke('omni:stenographer-get-proposals'),
  evaluateProposal: (payload) => ipcRenderer.invoke('omni:stenographer-evaluate-proposal', payload),
  executeTool: (payload) => ipcRenderer.invoke('omni:stenographer-execute-tool', payload)
});

// Target Architecture: Grouped OmniEng API namespace
contextBridge.exposeInMainWorld('omnieng', {
  projects: {
    newProject: (params) => ipcRenderer.invoke('omni:new-project', params),
    saveProject: (params) => ipcRenderer.invoke('omni:save-project', params),
    openProject: (params) => ipcRenderer.invoke('omni:open-project', params),
    new: (params) => ipcRenderer.invoke('omni:new-project', params),
    save: (params) => ipcRenderer.invoke('omni:save-project', params),
    open: (params) => ipcRenderer.invoke('omni:open-project', params),
    undo: () => ipcRenderer.invoke('omni:undo'),
    redo: () => ipcRenderer.invoke('omni:redo'),
    getHistory: () => ipcRenderer.invoke('omni:get-project-history'),
    recordCommand: (params) => ipcRenderer.invoke('omni:record-project-command', params),
    getSummary: () => ipcRenderer.invoke('omni:get-project-summary'),
    addBlob: (payload) => ipcRenderer.invoke('omni:add-blob', payload),
    getBlob: (payload) => ipcRenderer.invoke('omni:get-blob', payload),
    listBlobs: () => ipcRenderer.invoke('omni:list-blobs')
  },
  jobs: {
    submit: (taskType, payload, options) =>
      ipcRenderer.invoke('omni:submit-compute-job', { taskType, payload, options }),
    cancel: (jobId) => ipcRenderer.invoke('omni:cancel-compute-job', { jobId }),
    getTelemetry: () => ipcRenderer.invoke('omni:get-compute-telemetry')
  },
  artifacts: {
    package: (params) => ipcRenderer.invoke('omni:package-omni-archive', params),
    load: (archiveBytes) => ipcRenderer.invoke('omni:load-omni-archive', archiveBytes),
    encryptVault: (params) => ipcRenderer.invoke('omni:vault-encrypt-project', params),
    decryptVault: (params) => ipcRenderer.invoke('omni:vault-decrypt-project', params)
  },
  domains: {
    cad: {
      createPrimitive: (type, params) => ipcRenderer.invoke('omni:create-cad-primitive', { type, params }),
      evaluateNurbs: (params) => ipcRenderer.invoke('omni:evaluate-nurbs', params),
      intersectNurbsSSI: (params) => ipcRenderer.invoke('omni:intersect-nurbs-ssi', params),
      applyEdgeBlend: (params) => ipcRenderer.invoke('omni:apply-edge-blend', params),
      solveAssemblyMates: (params) => ipcRenderer.invoke('omni:solve-assembly-mates', params),
      solveVariationalSketch: (params) => ipcRenderer.invoke('omni:solve-variational-sketch', params),
      healGeometry: (params) => ipcRenderer.invoke('omni:heal-cad-geometry', params),
      exportSTEP: (bodyData) => ipcRenderer.invoke('omni:export-step', bodyData),
      exportCADOBJ: (bodyData) => ipcRenderer.invoke('omni:export-cad-obj', bodyData),
      visualDiffCAD: (params) => ipcRenderer.invoke('omni:visual-diff-cad', params),
      solveSlvsConstraints: (params) => ipcRenderer.invoke('cad:solve-slvs-constraints', params),
      executeOccBrepOperation: (params) => ipcRenderer.invoke('cad:execute-occ-brep-operation', params)
    },
    cae: {
      solveFEA: (params) => ipcRenderer.invoke('omni:solve-fea-hex20', params),
      solveDropTest: (params) => ipcRenderer.invoke('omni:solve-drop-test', params),
      solveTransientDrop: (params) => ipcRenderer.invoke('omni:solve-transient-drop', params),
      solveContinuumPlasticity3D: (params) => ipcRenderer.invoke('omni:solve-continuum-plasticity-3d', params),
      solveContactMechanics3D: (params) => ipcRenderer.invoke('omni:solve-contact-mechanics-3d', params),
      meshDelaunay3D: (params) => ipcRenderer.invoke('omni:mesh-delaunay-3d', params),
      meshHybridPrismTet: (params) => ipcRenderer.invoke('omni:mesh-hybrid-prism-tet', params)
    },
    cfd: {
      solveFvmCFD3D: (params) => ipcRenderer.invoke('omni:solve-fvm-cfd-3d', params),
      stepSimpleCFD: (params) => ipcRenderer.invoke('omni:step-simple-cfd', params),
      solveWebGPUCFDPoisson: (params) => ipcRenderer.invoke('omni:solve-webgpu-cfd-poisson', params)
    },
    controls: {
      simulateBlockDiagram: (graphData, tEnd, dt) =>
        ipcRenderer.invoke('omni:simulate-block-diagram', {
          graphData,
          tEnd,
          dt,
          units: DEFAULT_BLOCK_DIAGRAM_UNITS
        }),
      solveBode: (params) => ipcRenderer.invoke('omni:solve-bode', params),
      solveMPC: (params) => ipcRenderer.invoke('omni:solve-mpc', params),
      runFmiCoSimulation: (params) => ipcRenderer.invoke('omni:run-fmi-cosimulation', params),
      scheduleMultiRate: (params) => ipcRenderer.invoke('omni:schedule-multi-rate', params),
      solveAlgebraicLoop: (params) => ipcRenderer.invoke('omni:solve-algebraic-loop', params)
    },
    robotics: {
      runRoboticsOperation: (payload) => ipcRenderer.invoke('omni:run-robotics-operation', payload)
    },
    eda: {
      synthesizeVerilog: (source) => ipcRenderer.invoke('omni:synthesize-verilog', source),
      synthesizeSystemVerilog: (params) => ipcRenderer.invoke('omni:synthesize-system-verilog', params),
      runDRC: (shapes, rules) => ipcRenderer.invoke('omni:run-drc', { shapes, rules }),
      runLVS: (schematic, layout) => ipcRenderer.invoke('omni:run-lvs', { schematic, layout }),
      runMcmmSTA: (params) => ipcRenderer.invoke('omni:run-mcmm-sta', params),
      extractPex3D: (params) => ipcRenderer.invoke('omni:extract-pex-3d', params),
      solveSpiceCircuit: (netlist) => ipcRenderer.invoke('omni:solve-spice-circuit', netlist),
      exportGerber: (pcbData) => ipcRenderer.invoke('omni:export-gerber', pcbData),
      exportGdsii: (params) => ipcRenderer.invoke('omni:export-gdsii', params),
      importGdsii: (buffer) => ipcRenderer.invoke('omni:import-gdsii', buffer)
    },
    optics: {
      solveOptics: (params) => ipcRenderer.invoke('omni:solve-optics', params),
      traceRays: (params) => ipcRenderer.invoke('omni:trace-rays', params),
      solveSkewOptics: (params) => ipcRenderer.invoke('omni:solve-skew-optics', params),
      tracePolarizationRay: (params) => ipcRenderer.invoke('omni:trace-polarization-ray', params),
      queryGlassCatalog: (params) => ipcRenderer.invoke('omni:query-glass-catalog', params),
      queryGlassLookup: (params) => ipcRenderer.invoke('omni:optics-glass-lookup', params),
      runOpticalTolerancing: (params) => ipcRenderer.invoke('omni:run-optical-tolerancing', params)
    },
    plant: {
      solveHYSYSFlash: (params) => ipcRenderer.invoke('omni:solve-hysys-flash', params),
      flashPengRobinson: (params) => ipcRenderer.invoke('omni:flash-peng-robinson', params),
      simulateDistillation: (params) => ipcRenderer.invoke('omni:simulate-distillation', params),
      solveMeshDistillation: (params) => ipcRenderer.invoke('omni:solve-mesh-distillation', params),
      solveWaterHammerMOC: (params) => ipcRenderer.invoke('omni:solve-water-hammer-moc', params),
      getVLEEnvelope: (params) => ipcRenderer.invoke('omni:get-vle-envelope', params),
      plantNrtlActivity: (params) => ipcRenderer.invoke('omni:plant-nrtl-activity', params),
      calculateSteamProperties: (payload) => ipcRenderer.invoke('omni:calculate-steam-properties', payload),
      generatePID: (params) => ipcRenderer.invoke('omni:generate-p-id', params),
      getAsmePipingCatalog: (params) => ipcRenderer.invoke('plant:get-asme-piping-catalog', params),
      generatePiping3DGeometry: (params) => ipcRenderer.invoke('plant:generate-piping-3d-geometry', params),
      runCaesarStressAnalysis: (params) => ipcRenderer.invoke('plant:run-caesar-stress-analysis', params),
      exportPCF: (params) => ipcRenderer.invoke('plant:export-pcf', params)
    },
    cam: {
      camGenerateToolpath: (params) => ipcRenderer.invoke('omni:cam-generate-toolpath', params)
    },
    aerospace: {
      solveNasaRocket: (params) => ipcRenderer.invoke('omni:solve-nasa-rocket', params),
      solvePropellerThrust: (params) => ipcRenderer.invoke('omni:solve-propeller', params),
      simulateDrone: (params) => ipcRenderer.invoke('omni:simulate-drone', params),
      compileRocketNozzle: (params) => ipcRenderer.invoke('omni:compile-rocket-nozzle', params),
      runAerospaceCFD: (params) => ipcRenderer.invoke('omni:run-aerospace-cfd', params),
      calculateOrbitalTransfer: (params) => ipcRenderer.invoke('omni:calculate-orbital-transfer', params)
    },
    pdm: {
      rollupEBOM: (params) => ipcRenderer.invoke('omni:rollup-ebom', params),
      visualDiffCAD: (params) => ipcRenderer.invoke('omni:visual-diff-cad', params)
    },
    hpc: {
      getClusterStatus: () => ipcRenderer.invoke('omni:get-cluster-status'),
      setMembership: (active) => ipcRenderer.invoke('omni:set-membership', active),
      submitHPCJob: (jobType, params, ranks) => ipcRenderer.invoke('omni:submit-hpc-job', { jobType, params, ranks }),
      localDispatch: (params) => ipcRenderer.invoke('omni:hpc-local-dispatch', params),
      generateSlurmBatchScript: (params) => ipcRenderer.invoke('hpc:generate-slurm-batch-script', params),
      generateOpenfoamCase: (params) => ipcRenderer.invoke('hpc:generate-openfoam-case', params),
      generateCalculixCase: (params) => ipcRenderer.invoke('hpc:generate-calculix-case', params),
      parseSolverTelemetry: (params) => ipcRenderer.invoke('hpc:parse-solver-telemetry', params)
    }
  },
  stenographer: {
    processPrompt: (prompt, context) => ipcRenderer.invoke('omni:stenographer-query', { prompt, context }),
    query: (payload) => ipcRenderer.invoke('omni:stenographer-query', payload),
    getTools: () => ipcRenderer.invoke('omni:stenographer-get-tools'),
    getProposals: () => ipcRenderer.invoke('omni:stenographer-get-proposals'),
    evaluateProposal: (payload) => ipcRenderer.invoke('omni:stenographer-evaluate-proposal', payload),
    executeTool: (payload) => ipcRenderer.invoke('omni:stenographer-execute-tool', payload),
    verifyLedger: () => ipcRenderer.invoke('omni:stenographer-verify-ledger')
  }
});

// OpenCASCADE B-Rep & SolveSpace Variational CAD and ASME Piping APIs
contextBridge.exposeInMainWorld('electronAPI', {
  cad: {
    solveSlvsConstraints: (params) => ipcRenderer.invoke('cad:solve-slvs-constraints', params),
    executeOccBrepOperation: (params) => ipcRenderer.invoke('cad:execute-occ-brep-operation', params)
  },
  plant: {
    getAsmePipingCatalog: (params) => ipcRenderer.invoke('plant:get-asme-piping-catalog', params),
    generatePiping3DGeometry: (params) => ipcRenderer.invoke('plant:generate-piping-3d-geometry', params),
    runCaesarStressAnalysis: (params) => ipcRenderer.invoke('plant:run-caesar-stress-analysis', params),
    exportPCF: (params) => ipcRenderer.invoke('plant:export-pcf', params)
  },
  hpc: {
    generateSlurmBatchScript: (params) => ipcRenderer.invoke('hpc:generate-slurm-batch-script', params),
    generateOpenfoamCase: (params) => ipcRenderer.invoke('hpc:generate-openfoam-case', params),
    generateCalculixCase: (params) => ipcRenderer.invoke('hpc:generate-calculix-case', params),
    parseSolverTelemetry: (params) => ipcRenderer.invoke('hpc:parse-solver-telemetry', params)
  }
});
