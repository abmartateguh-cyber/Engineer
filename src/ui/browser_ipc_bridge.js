/**
 * OmniEng Browser IPC Bridge Polyfill.
 *
 * Automatically detects whether OmniEng is running inside Electron (native)
 * or in a standard web browser (Chrome, Safari, Firefox, Edge, iPad).
 *
 * In browser mode:
 * - Transparently maps `window.electronAPI.invoke(channel, ...args)` to HTTP POST /api/ipc.
 * - Constructs `window.omniEngAPI` proxy mapping every method call to `/api/ipc`.
 * - Enables full workstation functionality without native binaries.
 */

'use strict';

(function () {
  const isElectron = !!(window.process && window.process.type) || !!window.omniEngAPI;
  if (isElectron) {
    console.log('[OmniEng Bridge] Running in native Electron environment.');
    return;
  }

  console.log('[OmniEng Bridge] Running in Web Workstation mode; initializing HTTP IPC bridge.');

  let sessionToken = null;

  async function ensureSessionToken() {
    if (sessionToken) return sessionToken;
    try {
      const res = await fetch('/api/session', { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        sessionToken = data.token || null;
      }
    } catch (_) {
      sessionToken = null;
    }
    return sessionToken;
  }

  async function callServerIpc(channel, args) {
    try {
      const token = await ensureSessionToken();
      const response = await fetch('/api/ipc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OmniEng-Channel': channel,
          ...(token ? { 'X-OmniEng-Session': token } : {})
        },
        body: JSON.stringify({ channel, args })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: { message: `HTTP ${response.status} ${response.statusText}` }
        }));
        throw new Error(errorData.error?.message || `IPC Call Failed: ${channel}`);
      }

      return await response.json();
    } catch (err) {
      console.error(`[Web IPC Error] ${channel}:`, err);
      throw err;
    }
  }

  // Universal electronAPI shim
  window.electronAPI = {
    invoke: (channel, ...args) => {
      const payload = args.length === 1 ? args[0] : args.length > 1 ? args : undefined;
      return callServerIpc(channel, payload);
    },
    on: () => {},
    removeListener: () => {},
    plant: {
      getAsmePipingCatalog: (params) => window.electronAPI.invoke('plant:get-asme-piping-catalog', params),
      generatePiping3DGeometry: (params) => window.electronAPI.invoke('plant:generate-piping-3d-geometry', params),
      runCaesarStressAnalysis: (params) => window.electronAPI.invoke('plant:run-caesar-stress-analysis', params),
      exportPCF: (params) => window.electronAPI.invoke('plant:export-pcf', params)
    }
  };

  // Channel mapping for common omniEngAPI methods
  const METHOD_TO_CHANNEL = {
    // Consumer & Drop Test
    solveDropTest: 'omni:solve-drop-test',
    solveThermal: 'omni:solve-thermal',

    // EDA
    synthesizeVerilog: 'omni:synthesize-verilog',
    runDRC: 'omni:run-drc',
    runLVS: 'omni:run-lvs',
    exportGerber: 'omni:export-gerber',
    solveSpiceCircuit: 'omni:solve-spice-circuit',

    // Aerospace & CFD
    solveCFD: 'omni:solve-cfd',
    solvePropellerThrust: 'omni:solve-propeller',
    simulateDrone: 'omni:simulate-drone',
    solveNasaRocket: 'omni:solve-nasa-rocket',
    solveCryogenicLoading: 'omni:solve-cryogenic-loading',
    simulateAsiIgnition: 'omni:simulate-asi-ignition',
    getRocketFeatureTree: 'omni:get-rocket-feature-tree',
    getNasaSpacecraftSpec: 'omni:get-nasa-spacecraft-spec',

    // Chemical & Plant
    solveHYSYSFlash: 'omni:solve-hysys-flash',
    simulateDistillation: 'omni:simulate-distillation',
    evaluatePipingStress: 'omni:evaluate-piping-stress',
    solveFlowsheet: 'omni:solve-flowsheet',
    getVLEEnvelope: 'omni:get-vle-envelope',
    getColumnProfile: 'omni:get-column-profile',
    queryDipprDatabase: 'omni:query-dippr-database',
    solveVlleFlash: 'omni:solve-vlle-flash',
    solveMeshDistillation: 'omni:solve-mesh-distillation',
    solveWaterHammerMOC: 'omni:solve-water-hammer-moc',

    // CAD
    createCadPrimitive: 'omni:create-cad-primitive',
    exportCADOBJ: 'omni:export-cad-obj',
    exportSTEP: 'omni:export-step',
    evaluateNurbs: 'omni:evaluate-nurbs',
    intersectBasicNurbs: 'omni:intersect-basic-nurbs-ssi',
    applyEdgeBlend: 'omni:apply-edge-blend',
    solveAssemblyMates: 'omni:solve-assembly-mates',
    generateDraftingSheet: 'omni:generate-drafting-sheet',

    // AI & HPC
    processAIPrompt: 'omni:ai-process-prompt',
    aiTrainSurrogate: 'omni:ai-train-surrogate',
    aiPredictSurrogate: 'omni:ai-predict-surrogate',
    getClusterStatus: 'omni:get-cluster-status',
    setMembership: 'omni:set-membership',
    submitHPCJob: 'omni:submit-hpc-job',
    generateAuditReport: 'omni:generate-audit-report',

    // Materials
    getMaterialsList: 'omni:get-materials-list',
    materialsCatalogQuery: 'omni:materials-catalog-query',
    computeInertia: 'omni:compute-inertia',
    computeCuboidMassProperties: 'omni:compute-cuboid-mass-properties',

    // Dynamics
    solveTransientDrop: 'omni:solve-transient-drop',
    solveBode: 'omni:solve-bode',

    // Optics
    solveOptics: 'omni:solve-optics',
    traceRays: 'omni:trace-rays',
    getLensPrescription: 'omni:get-lens-prescription',
    solveSkewOptics: 'omni:solve-skew-optics',
    getCameraLensMaster: 'omni:get-camera-lens-master',

    // Lifecycle
    newProject: 'omni:new-project',
    saveProject: 'omni:save-project',
    openProject: 'omni:open-project',
    undoProjectCommand: 'omni:undo',
    redoProjectCommand: 'omni:redo',
    getProjectHistory: 'omni:get-project-history',
    recordProjectCommand: 'omni:record-project-command',
    getProjectSummary: 'omni:get-project-summary',
    getCommunitySamples: 'omni:get-community-samples'
  };

  // Fallback proxy that dynamically routes any method to an IPC channel
  window.omniEngAPI = new Proxy(
    {},
    {
      get: (target, prop) => {
        if (prop in target) return target[prop];
        return async (...args) => {
          let channel = METHOD_TO_CHANNEL[prop];
          if (!channel) {
            // Convert camelCase to kebab: e.g. solveSomething -> omni:solve-something
            const kebab = String(prop)
              .replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2')
              .toLowerCase();
            channel = `omni:${kebab}`;
          }
          const payload = args.length === 1 ? args[0] : args.length > 1 ? args : undefined;
          return callServerIpc(channel, payload);
        };
      }
    }
  );

  console.log('[OmniEng Bridge] Web Workstation IPC Bridge successfully mounted.');
})();
