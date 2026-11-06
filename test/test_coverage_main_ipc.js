'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');

const repositoryRoot = path.resolve(__dirname, '..');
const handlers = new Map();

const electronMock = {
  app: { getAppPath: () => repositoryRoot },
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler)
  },
  dialog: {
    showSaveDialog: async () => ({ canceled: false, filePath: path.join(os.tmpdir(), `test_save_${Date.now()}.omni`) }),
    showOpenDialog: async () => ({
      canceled: false,
      filePaths: [path.join(os.tmpdir(), `test_open_${Date.now()}.omni`)]
    })
  }
};

const originalLoad = Module._load;
Module._load = function loadWithElectronIpcMock(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

let registerAllIpcHandlers, defineHandlerModule;
let registerSystemIpc,
  registerCaeIpc,
  registerOpticsIpc,
  registerCadIpc,
  registerEdaIpc,
  registerPlantIpc,
  registerControlsIpc;
let handleStandardCellLibraryRequest;
let HeadlessSolverDaemon, getComputeHost, ComputeHostProcess;
let featureMaturity;
let StenographerSupervisor;
let activeProjectManager;

try {
  ({ registerAllIpcHandlers } = require('../src/main/ipc/index'));
  defineHandlerModule = require('../src/main/ipc/define_handler');
  ({ registerSystemIpc, activeProjectManager } = require('../src/main/ipc/system_ipc'));
  ({ registerCaeIpc } = require('../src/main/ipc/cae_ipc'));
  ({ registerOpticsIpc } = require('../src/main/ipc/optics_ipc'));
  ({ registerCadIpc } = require('../src/main/ipc/cad_ipc'));
  ({ registerEdaIpc, handleStandardCellLibraryRequest } = require('../src/main/ipc/eda_ipc'));
  ({ registerPlantIpc } = require('../src/main/ipc/plant_ipc'));
  ({ registerControlsIpc } = require('../src/main/ipc/controls_ipc'));
  ({ HeadlessSolverDaemon } = require('../src/main/headless_solver_daemon'));
  ({ getComputeHost, ComputeHostProcess } = require('../src/main/compute_host'));
  featureMaturity = require('../src/core/maturity/feature_maturity');
  ({ StenographerSupervisor } = require('../src/main/stenographer_supervisor'));
} finally {
  Module._load = originalLoad;
}

const caeIpcExports = require('../src/main/ipc/cae_ipc');
const opticsIpcExports = require('../src/main/ipc/optics_ipc');
const cadIpcExports = require('../src/main/ipc/cad_ipc');
const controlsIpcExports = require('../src/main/ipc/controls_ipc');
const plantIpcExports = require('../src/main/ipc/plant_ipc');
const edaIpcExports = require('../src/main/ipc/eda_ipc');
const {
  SYNTHETIC_CONTINUUM_MATERIAL,
  SYNTHETIC_LINEAR_ELASTIC_MATERIAL
} = require('./support/synthetic_cae_materials');

async function runMainIpcCoverageTests() {
  console.log('================================================================');
  console.log('       TESTING MAIN PROCESS IPC ROUTERS, DAEMONS & HOSTS        ');
  console.log('================================================================');

  let passedTests = 0;
  let failedTests = 0;
  let currentSection = 'suite setup';

  try {
    const entryUrl = pathToFileURL(path.join(repositoryRoot, 'src', 'index.html')).href;
    const trustedEvent = {
      sender: {
        isDestroyed: () => false,
        mainFrame: { frameTreeNodeId: 42 }
      },
      senderFrame: { frameTreeNodeId: 42, url: entryUrl }
    };

    // 1. Channel Registry & define_handler helpers
    currentSection = '[1/13] IPC define_handler';
    console.log('\n[1] IPC define_handler registration & query...');
    defineHandlerModule.channelRegistry.clear();
    handlers.clear();

    const mockDeps = {
      hpcEngine: {
        getClusterStatus: () => ({ success: true, nodes: 4, status: 'ONLINE' }),
        setMembership: (active) => ({ success: true, active }),
        submitSimulationJob: (type, params, ranks) => ({ success: true, jobId: 'hpc_1', ranks })
      },
      designWizards: {
        test_wiz: { runWizard: (inputs) => ({ status: 'designed', inputs }) },
        drop_test: {
          runWizard: () => {
            throw new TypeError('Simulated missing parameter in drop_test');
          }
        }
      },
      auditLedger: {
        recordAction: (author, actionType, details) => ({ id: 1, author, actionType, details }),
        verifyChainIntegrity: () => ({ valid: true, length: 1 })
      },
      keymapManager: {
        getProfilesList: () => ['CATIA', 'SolidWorks', 'Blender'],
        currentProfile: 'CATIA'
      },
      validationService: {
        runBenchmarks: ({ suite }) => ({ success: true, suite, passed: 10 })
      },
      hsmProvider: {
        sign: (p) => ({ success: true, signature: 'deadbeef' }),
        verify: (p) => ({ success: true, valid: true })
      },
      ipcMain: electronMock.ipcMain,
      outOfCoreOctree: {
        evaluateVisibleLODs: () => ({ visibleLODs: [], visibleCount: 0 })
      }
    };

    const regResult = registerAllIpcHandlers(mockDeps);
    assert.strictEqual(regResult.success, true);
    assert(regResult.registeredCount > 100);
    assert(defineHandlerModule.getRegisteredChannels().length > 100);
    assert.strictEqual(defineHandlerModule.isChannelRegistered('omni:get-feature-maturity'), true);
    assert.strictEqual(defineHandlerModule.isChannelRegistered('omni:nonexistent-channel'), false);
    passedTests++;
    console.log(`  ✓ PASSED: ${regResult.registeredCount} channels registered and verified in define_handler`);

    // 2. System IPC Domain (omni:*)
    currentSection = '[2/13] System IPC';
    console.log('\n[2] System Domain IPC Channels...');
    {
      // Feature maturity
      const mat = await handlers.get('omni:get-feature-maturity')(trustedEvent);
      assert.strictEqual(mat.success, true);
      assert(typeof mat.domains === 'object' && mat.domains !== null && mat.domains.cad !== undefined);

      // AI prompt
      const aiRes = await handlers.get('omni:ai-process-prompt')(trustedEvent, {
        prompt: 'design cantilever beam with length 500mm'
      });
      assert.strictEqual(aiRes.success, true);

      // Community samples
      const samples = await handlers.get('omni:get-community-samples')(trustedEvent);
      assert(Array.isArray(samples));

      // HPC cluster status & membership
      const cluster = await handlers.get('omni:get-cluster-status')(trustedEvent);
      assert.strictEqual(cluster.success, true);
      const member = await handlers.get('omni:set-membership')(trustedEvent, true);
      assert.strictEqual(member.success, true);
      const hpcJob = await handlers.get('omni:submit-hpc-job')(trustedEvent, {
        jobType: 'fea_static',
        params: { mesh: 'quad' },
        ranks: 4
      });
      assert.strictEqual(hpcJob.success, true);
      const hpcJobInvalid = await handlers.get('omni:submit-hpc-job')(trustedEvent, { jobType: '' });
      assert.strictEqual(hpcJobInvalid.success, false);

      // Audit report
      const auditRep = await handlers.get('omni:generate-audit-report')(trustedEvent, {});
      assert(auditRep !== null);

      // Materials list
      const matList = await handlers.get('omni:get-materials-list')(trustedEvent);
      assert.strictEqual(matList.available, false);

      // Omni Archive package & load
      const pkg = await handlers.get('omni:package-omni-archive')(trustedEvent, {
        projectName: 'TestPkg',
        engineeringDomain: 'optics',
        sections: { optical_bench: Buffer.from('bench data') }
      });
      assert.strictEqual(pkg.success, true);
      assert(pkg.sizeBytes > 0);

      const loadArchive = await handlers.get('omni:load-omni-archive')(
        trustedEvent,
        Buffer.from('not an omni archive')
      );
      assert.strictEqual(loadArchive.success, false);

      // Project lifecycle: new, save, open, record command, undo, redo, history, summary
      const newProj = await handlers.get('omni:new-project')(trustedEvent, {
        projectName: 'AeroWing',
        engineeringDomain: 'aerospace'
      });
      assert.strictEqual(newProj.success, true);

      const recCmd = await handlers.get('omni:record-project-command')(trustedEvent, {
        actionType: 'wing.spar.extrude',
        forwardPatch: { depthMm: 1200 },
        reversePatch: { depthMm: 0 },
        description: 'Extrude main spar'
      });
      assert.strictEqual(recCmd.success, true);

      const hist = await handlers.get('omni:get-project-history')(trustedEvent);
      assert.strictEqual(hist.success, true);
      assert.strictEqual(hist.canUndo, true);

      const undoRes = await handlers.get('omni:undo')(trustedEvent);
      assert.strictEqual(undoRes.success, true);

      const redoRes = await handlers.get('omni:redo')(trustedEvent);
      assert.strictEqual(redoRes.success, true);

      const summary = await handlers.get('omni:get-project-summary')(trustedEvent);
      assert.strictEqual(summary.success, true);

      const tmpSavePath = path.join(os.tmpdir(), `test_proj_ipc_${Date.now()}.omni`);
      const saveRes = await handlers.get('omni:save-project')(trustedEvent, { filePath: tmpSavePath });
      assert.strictEqual(saveRes.success, true);

      const openRes = await handlers.get('omni:open-project')(trustedEvent, { filePath: tmpSavePath });
      assert.strictEqual(openRes.success, true);
      try {
        if (fs.existsSync(tmpSavePath)) fs.unlinkSync(tmpSavePath);
      } catch (_) {}

      // Design wizards
      const droneWiz = await handlers.get('omni:run-design-wizard')(trustedEvent, { wizardType: 'drone' });
      assert.strictEqual(droneWiz.status, 'unavailable');

      const dropWiz = await handlers.get('omni:run-design-wizard')(trustedEvent, { wizardType: 'drop_test' });
      assert.strictEqual(dropWiz.status, 'INVALID_INPUT');

      const okWiz = await handlers.get('omni:run-design-wizard')(trustedEvent, {
        wizardType: 'test_wiz',
        inputs: { p: 1 }
      });
      assert.strictEqual(okWiz.success, true);

      const unkWiz = await handlers.get('omni:run-design-wizard')(trustedEvent, { wizardType: 'unknown_xyz' });
      assert.strictEqual(unkWiz.success, false);

      // Self-heal design (structural remediation)
      const heal = await handlers.get('omni:self-heal-design')(trustedEvent, {
        safetyFactor: 1.5,
        currentDesign: {
          wallThicknessMm: 2.0,
          loadN: 500,
          lengthMm: 100,
          widthMm: 20,
          yieldStrengthMPa: 250,
          youngsModulusGPa: 200,
          minThicknessMm: 1.0,
          maxThicknessMm: 10.0
        }
      });
      assert.strictEqual(heal.available, false);

      // ASME Section VIII Div 2 stress evaluation
      const asmeRes = await handlers.get('omni:evaluate-asme-viii-div2')(trustedEvent, {
        allowableStressS: 138,
        allowableStressSource: 'ASME BPVC Section II Part D Table 5A',
        isSecondaryThermal: false,
        wallThicknessMm: 20.0,
        sclPoints: [
          { x: -10.0, stressMpa: 120 },
          { x: 10.0, stressMpa: 150 }
        ]
      });
      assert.strictEqual(asmeRes.success, true);

      // Security validation
      const secVal = await handlers.get('omni:security-validate-input')(trustedEvent, {
        payload: { x: 10, y: 20 },
        finiteFields: ['x', 'y']
      });
      assert.strictEqual(secVal.success, true);

      // Audit record action & keymap
      const auditAct = await handlers.get('omni:audit-record-action')(trustedEvent, {
        author: 'QA_BOT',
        actionType: 'VERIFY_STRESS',
        details: { maxStressMPa: 120 }
      });
      assert.strictEqual(auditAct.success, true);

      const keymaps = await handlers.get('omni:get-keymap-profiles')(trustedEvent);
      assert.strictEqual(keymaps.success, true);

      // Hardware acceleration & system info
      const accel = await handlers.get('omni:get-accelerator-info')(trustedEvent);
      assert.strictEqual(accel.success, true);
      const sys = await handlers.get('omni:get-system-info')(trustedEvent);
      assert(sys.platform.length > 0);

      // Compute job submit, telemetry & cancel
      const compJob = await handlers.get('omni:submit-compute-job')(trustedEvent, {
        taskType: 'SPARSE_CHOLESKY',
        payload: {
          n: 2,
          entries: [
            [0, 0, 4],
            [1, 1, 9]
          ],
          b: [4, 9]
        },
        options: { priority: 'HIGH' }
      });
      assert.strictEqual(compJob.success, true);
      assert.strictEqual(compJob.result.success, true);

      const compInvalid = await handlers.get('omni:submit-compute-job')(trustedEvent, { taskType: '' });
      assert.strictEqual(compInvalid.success, false);

      const cancelComp = await handlers.get('omni:cancel-compute-job')(trustedEvent, { jobId: 'none_job' });
      assert.strictEqual(cancelComp.success, true);

      const compTelem = await handlers.get('omni:get-compute-telemetry')(trustedEvent);
      assert.strictEqual(compTelem.success, true);

      // V&V benchmarks, PKCS#11, IAM, SBOM, Mesh decomposition
      const vvRes = await handlers.get('omni:run-vv-benchmarks')(trustedEvent);
      assert.strictEqual(vvRes.success, true);

      const hsmSign = await handlers.get('omni:pkcs11-sign-payload')(trustedEvent, { payload: 'manifest_data' });
      assert.strictEqual(hsmSign.success, true);
      const hsmSignErr = await handlers.get('omni:pkcs11-sign-payload')(trustedEvent, { payload: '' });
      assert.strictEqual(hsmSignErr.success, false);

      const hsmVerify = await handlers.get('omni:pkcs11-verify-signature')(trustedEvent, {
        payload: 'manifest_data',
        signatureHex: 'deadbeef'
      });
      assert.strictEqual(hsmVerify.success, true);
      const hsmVerifyErr = await handlers.get('omni:pkcs11-verify-signature')(trustedEvent, { payload: '' });
      assert.strictEqual(hsmVerifyErr.success, false);

      const iamRes = await handlers.get('omni:iam-evaluate-access')(trustedEvent);
      assert.strictEqual(iamRes.success, false);

      const sbomRes = await handlers.get('omni:generate-sbom')(trustedEvent);
      assert.strictEqual(sbomRes.success, true);
      assert.match(sbomRes.manifestDigest, /^[0-9a-f]{64}$/);
      assert(Number.isInteger(sbomRes.cyclonedxComponentCount) && sbomRes.cyclonedxComponentCount > 0);
      assert(Number.isInteger(sbomRes.spdxPackageCount) && sbomRes.spdxPackageCount > 0);

      const decompRes = await handlers.get('omni:mesh-domain-decomposition')(trustedEvent, {
        nodes: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 0, y: 0, z: 1 }
        ],
        elements: [[0, 1, 2, 3]],
        numPartitions: 2
      });
      assert.strictEqual(decompRes.success, true);

      const decompErr = await handlers.get('omni:mesh-domain-decomposition')(trustedEvent, { nodes: [] });
      assert.strictEqual(decompErr.success, false);

      const goldBench = await handlers.get('omni:run-100-gold-benchmarks')(trustedEvent);
      assert.strictEqual(goldBench.success, true);

      // Stenographer query, tools, proposals, ledger
      const currRev = activeProjectManager.getManifest()?.revision;
      const stenoQ = await handlers.get('omni:stenographer-query')(trustedEvent, {
        prompt: 'help design thermal shield',
        projectRevision: currRev
      });
      assert(stenoQ !== null && (stenoQ.status === 'UNAVAILABLE' || stenoQ.success === true));

      const stenoTools = await handlers.get('omni:stenographer-get-tools')(trustedEvent);
      assert.strictEqual(stenoTools.success, true);

      const stenoProposals = await handlers.get('omni:stenographer-get-proposals')(trustedEvent);
      assert.strictEqual(stenoProposals.success, true);

      const evalProp = await handlers.get('omni:stenographer-evaluate-proposal')(trustedEvent, {
        proposalId: 'nonexistent'
      });
      assert.strictEqual(evalProp.success, false);

      const execTool = await handlers.get('omni:stenographer-execute-tool')(trustedEvent, {
        proposalId: 'nonexistent'
      });
      assert.strictEqual(execTool.success, false);

      const verifyLedger = await handlers.get('omni:stenographer-verify-ledger')(trustedEvent);
      assert(verifyLedger.success !== undefined);

      // CAS Blobs
      const addBlobRes = await handlers.get('omni:add-blob')(trustedEvent, {
        content: 'thermal boundary conditions layer 1',
        mimeType: 'text/plain'
      });
      assert.strictEqual(addBlobRes.success, true);
      const blobHash = typeof addBlobRes.hash === 'string' ? addBlobRes.hash : addBlobRes.hash.hash;
      assert.strictEqual(blobHash.length, 64);

      const getBlobRes = await handlers.get('omni:get-blob')(trustedEvent, { hash: blobHash });
      assert.strictEqual(getBlobRes.success, true);
      assert.strictEqual(getBlobRes.content, 'thermal boundary conditions layer 1');

      const getMissingBlob = await handlers.get('omni:get-blob')(trustedEvent, {
        hash: '0000000000000000000000000000000000000000000000000000000000000000'
      });
      assert.strictEqual(getMissingBlob.success, false);

      const listBlobsRes = await handlers.get('omni:list-blobs')(trustedEvent);
      assert.strictEqual(listBlobsRes.success, true);
      assert(listBlobsRes.blobs.length >= 1);
      passedTests++;
      console.log('  ✓ PASSED: All 47 System IPC channels invoked and verified');
    }

    // 3. CAE Domain IPC Channels & Helper Functions
    currentSection = '[3/13] CAE IPC';
    console.log('\n[3] CAE Domain IPC Channels & Calculation Functions...');
    {
      // Timoshenko beam
      const beamOk = caeIpcExports.runTimoshenkoBeam({
        coords: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 }
        ],
        section: { E: 210e9, nu: 0.3, A: 0.01, Iy: 1e-4, Iz: 1e-4, J: 2e-4, ky: 0.85, kz: 0.85 },
        K: 1.0
      });
      assert.strictEqual(beamOk.success, true);
      const beamBad = caeIpcExports.runTimoshenkoBeam({});
      assert.strictEqual(beamBad.success, false);

      // Shell MITC4
      const shellOk = caeIpcExports.runShellMITC4({
        coords: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 0, y: 1, z: 0 }
        ],
        properties: { thickness: 0.005, E: 200e9, nu: 0.3, density: 7850 }
      });
      assert.strictEqual(shellOk.success, true);
      const shellBad = caeIpcExports.runShellMITC4({});
      assert.strictEqual(shellBad.success, false);

      // Unavailable responses
      assert.strictEqual(caeIpcExports.getCompositeAnalysisUnavailableResult().status, 'unavailable');
      assert.strictEqual(caeIpcExports.getPenaltyContactUnavailableResult().status, 'unavailable');

      // Transonic Riemann & Continuum Plasticity & 2D CFD
      const riemann = caeIpcExports.runTransonicRiemann({
        method: 'shocktube',
        nCells: 10,
        tEnd: 0.001,
        cfl: 0.4
      });
      assert.strictEqual(riemann.success, true);
      caeIpcExports.runTransonicRiemann({
        method: 'roe',
        leftState: { rho: 1, u: 0, v: 0, w: 0, p: 1e5 },
        rightState: { rho: 0.125, u: 0, v: 0, w: 0, p: 1e4 },
        normal: { x: 1, y: 0, z: 0 }
      });

      const plast = caeIpcExports.runContinuumPlasticity({
        material: SYNTHETIC_CONTINUUM_MATERIAL,
        strainIncrement: [0.001, 0, 0, 0, 0, 0],
        strainRate: 10.0,
        temperature: 300.0
      });
      assert.strictEqual(plast.success, true);

      const cfd2d = caeIpcExports.runCfd2D({
        nx: 10,
        ny: 10,
        aoaDeg: 5,
        velocity: 10,
        chordRatio: 0.5,
        thicknessRatio: 0.12,
        iterations: 5
      });
      assert.strictEqual(cfd2d.success, true);

      // Delaunay 3D & Simple CFD & Sparse Cholesky
      const del3d = caeIpcExports.runDelaunayMesh3D({
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 0, y: 0, z: 1 }
        ],
        faces: [
          [0, 1, 2],
          [0, 1, 3],
          [1, 2, 3],
          [0, 2, 3]
        ],
        targetEdgeLength: 0.5,
        quadratic: false
      });
      assert.strictEqual(del3d.success, true);

      const fvm3d = caeIpcExports.runFvmCfd3D({
        nx: 2,
        ny: 2,
        nz: 2,
        lx: 1.0,
        ly: 1.0,
        lz: 1.0,
        inletVelocity: 5.0,
        steps: 1,
        omegaMRF: { x: 0, y: 0, z: 0 }
      });
      assert.strictEqual(fvm3d.success, true);

      const simpCfd = caeIpcExports.runSimpleCfdStep({
        cells: [
          { id: 0, centroid: { x: 0, y: 0, z: 0 }, volume: 1e-3, u: 1, v: 0, w: 0, p: 100 },
          { id: 1, centroid: { x: 1, y: 0, z: 0 }, volume: 1e-3, u: 1, v: 0, w: 0, p: 90 }
        ],
        faces: [{ leftCell: 0, rightCell: 1, area: 1, normal: { x: 1, y: 0, z: 0 } }]
      });
      assert.strictEqual(simpCfd.success, true);

      const spChol = caeIpcExports.runSparseCholesky({
        N: 2,
        triplets: [
          [0, 0, 4],
          [1, 1, 9]
        ],
        b: [4, 9]
      });
      assert.strictEqual(spChol.success, true);

      const wasmSp = caeIpcExports.runWasmSparse({
        N: 2,
        triplets: [
          [0, 0, 4],
          [1, 1, 9]
        ],
        b: [4, 9]
      });
      assert.strictEqual(wasmSp.success, true);

      const gpuPcg = caeIpcExports.runGpuPcg({
        csr: { N: 2, n: 2, rowPtr: [0, 1, 2], colIdx: [0, 1], colIndices: [0, 1], values: [4, 9] },
        b: [4, 9]
      });
      assert.strictEqual(gpuPcg.success, true);

      const webGpuP = caeIpcExports.runWebGpuPressurePoisson({ nx: 2, ny: 2, maxIter: 5, b: [0, 0, 0, 0] });
      assert.strictEqual(webGpuP.success, true);

      const hybridPrism = caeIpcExports.runHybridPrismTetMesh({
        surfaceMesh: {
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1]
          ],
          triangles: [
            [0, 1, 2],
            [0, 1, 3],
            [1, 2, 3],
            [0, 2, 3]
          ]
        },
        prismOptions: { firstLayerHeight: 0.01, growthRatio: 1.2, layerCount: 2, maxCornerAngleRad: 1.5 },
        tetOptions: { targetEdgeLength: 0.5, quadratic: false }
      });
      assert.strictEqual(hybridPrism.success, true);

      // 20-node HEX20 analysis
      const hex20Nodes = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
        { x: 1, y: 1, z: 1 },
        { x: 0, y: 1, z: 1 },
        { x: 0.5, y: 0, z: 0 },
        { x: 1, y: 0.5, z: 0 },
        { x: 0.5, y: 1, z: 0 },
        { x: 0, y: 0.5, z: 0 },
        { x: 0.5, y: 0, z: 1 },
        { x: 1, y: 0.5, z: 1 },
        { x: 0.5, y: 1, z: 1 },
        { x: 0, y: 0.5, z: 1 },
        { x: 0, y: 0, z: 0.5 },
        { x: 1, y: 0, z: 0.5 },
        { x: 1, y: 1, z: 0.5 },
        { x: 0, y: 1, z: 0.5 }
      ];
      const hex20Res = caeIpcExports.runHex20Analysis({
        coords: hex20Nodes,
        fixedNodes: [0, 1, 2, 3],
        loadNode: 4,
        force: { x: 0, y: 0, z: -500 },
        material: SYNTHETIC_LINEAR_ELASTIC_MATERIAL
      });
      assert.strictEqual(hex20Res.success, true);

      // Invoke remaining CAE IPC handler endpoints
      await handlers.get('omni:solve-drop-test')(trustedEvent, {
        dropHeight: 1.5,
        phoneMass: 0.18,
        impactAngle: 'corner'
      });
      await handlers.get('omni:solve-thermal')(trustedEvent, {
        conductivities: [200, 200],
        boundaryTemperatures: [300, 400],
        lengthM: 1.0
      });
      await handlers.get('omni:solve-cfd')(trustedEvent, {
        nx: 10,
        ny: 10,
        aoaDeg: 5,
        velocity: 10,
        chordRatio: 0.5,
        thicknessRatio: 0.12,
        iterations: 5
      });
      await handlers.get('omni:compute-inertia')(trustedEvent, {
        matKey: 'AL_6061',
        widthM: 0.1,
        heightM: 0.1,
        depthM: 0.1
      });
      await handlers.get('omni:compute-cuboid-mass-properties')(trustedEvent, {
        widthM: 0.1,
        heightM: 0.1,
        depthM: 0.1,
        densityKgM3: 7850,
        densitySource: 'AISI 1018 Steel Spec'
      });
      await handlers.get('omni:solve-transient-drop')(trustedEvent, {
        dropHeightM: 1.0,
        phoneMassKg: 0.18,
        impactAngle: 'corner',
        totalDurationMs: 10,
        stepCount: 5
      });
      await handlers.get('omni:mesh-delaunay-3d')(trustedEvent, {
        vertices: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 0, y: 0, z: 1 }
        ],
        faces: [
          [0, 1, 2],
          [0, 1, 3],
          [1, 2, 3],
          [0, 2, 3]
        ],
        targetEdgeLength: 0.5,
        quadratic: false
      });
      await handlers.get('omni:solve-continuum-plasticity-3d')(trustedEvent, {
        material: SYNTHETIC_CONTINUUM_MATERIAL,
        strainIncrement: [0.001, 0, 0, 0, 0, 0],
        strainRate: 10.0,
        temperature: 300.0
      });
      await handlers.get('omni:solve-fvm-cfd-3d')(trustedEvent, {
        nx: 2,
        ny: 2,
        nz: 2,
        lx: 1.0,
        ly: 1.0,
        lz: 1.0,
        inletVelocity: 5.0,
        steps: 1,
        omegaMRF: { x: 0, y: 0, z: 0 }
      });
      await handlers.get('omni:solve-sparse-cholesky')(trustedEvent, {
        N: 2,
        triplets: [
          [0, 0, 4],
          [1, 1, 9]
        ],
        b: [4, 9]
      });
      await handlers.get('omni:compute-shell-mitc4')(trustedEvent, {
        coords: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 0, y: 1, z: 0 }
        ],
        properties: { thickness: 0.005, E: 200e9, nu: 0.3, density: 7850 }
      });
      await handlers.get('omni:compute-beam-timoshenko')(trustedEvent, {
        coords: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 }
        ],
        section: { E: 210e9, nu: 0.3, A: 0.01, Iy: 1e-4, Iz: 1e-4, J: 2e-4, ky: 0.85, kz: 0.85 },
        K: 1.0
      });
      await handlers.get('omni:evaluate-composite-clpt')(trustedEvent, {});
      await handlers.get('omni:step-simple-cfd')(trustedEvent, {
        cells: [
          { id: 0, centroid: { x: 0, y: 0, z: 0 }, volume: 1e-3, u: 1, v: 0, w: 0, p: 100 },
          { id: 1, centroid: { x: 1, y: 0, z: 0 }, volume: 1e-3, u: 1, v: 0, w: 0, p: 90 }
        ],
        faces: [{ leftCell: 0, rightCell: 1, area: 1, normal: { x: 1, y: 0, z: 0 } }]
      });
      await handlers.get('omni:solve-wasm-sparse-multifrontal')(trustedEvent, {
        N: 2,
        triplets: [
          [0, 0, 4],
          [1, 1, 9]
        ],
        b: [4, 9]
      });
      await handlers.get('omni:solve-gpu-parallel-pcg')(trustedEvent, {
        csr: { N: 2, n: 2, rowPtr: [0, 1, 2], colIdx: [0, 1], colIndices: [0, 1], values: [4, 9] },
        b: [4, 9]
      });
      await handlers.get('omni:solve-webgpu-cfd-poisson')(trustedEvent, {
        nx: 2,
        ny: 2,
        maxIter: 5,
        b: [0, 0, 0, 0]
      });
      await handlers.get('omni:solve-contact-mechanics-3d')(trustedEvent, {
        radius: 10,
        load: 1000,
        E1: 200e9,
        nu1: 0.3,
        E2: 200e9,
        nu2: 0.3
      });
      await handlers.get('omni:cae-nonlinear-large-deflection')(trustedEvent, {
        length: 100,
        width: 10,
        height: 2,
        E: 200000,
        P: 50,
        lengthUnit: 'mm',
        modulusUnit: 'MPa',
        forceUnit: 'N'
      });
      await handlers.get('omni:mesh-hybrid-prism-tet')(trustedEvent, {
        surfaceMesh: {
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1]
          ],
          triangles: [
            [0, 1, 2],
            [0, 1, 3],
            [1, 2, 3],
            [0, 2, 3]
          ]
        },
        prismOptions: { firstLayerHeight: 0.01, growthRatio: 1.2, layerCount: 2, maxCornerAngleRad: 1.5 },
        tetOptions: { targetEdgeLength: 0.5, quadratic: false }
      });
      await handlers.get('omni:solve-transonic-riemann')(trustedEvent, {
        method: 'shocktube',
        nCells: 10,
        tEnd: 0.001,
        cfl: 0.4
      });
      await handlers.get('omni:solve-fea-hex20')(trustedEvent, {
        coords: hex20Nodes,
        fixedNodes: [0, 1, 2, 3],
        loadNode: 4,
        force: { x: 0, y: 0, z: -500 },
        material: { E: 200e9, nu: 0.3 }
      });
      await handlers.get('omni:solve-penalty-contact')(trustedEvent, {});
      passedTests++;
      console.log('  ✓ PASSED: All 23 CAE IPC channels and helper functions covered');
    }

    // 4. Optics Domain IPC Channels & Calculation Functions
    currentSection = '[4/13] Optics IPC';
    console.log('\n[4] Optics Domain IPC Channels & Calculation Functions...');
    {
      const dlsRes = opticsIpcExports.runOpticalDLS({
        system: {
          initialRefractiveIndex: 1.0,
          metricSampling: {
            entrancePupilRadiusMm: 10,
            paraxialRayHeightMm: 10,
            zonalRayFraction: 0.707,
            chiefRayAngleRad: 0.1
          },
          surfaces: [
            { radius: 50, thickness: 5, refractiveIndex: 1.5, semiDiameter: 12.5 },
            { radius: -50, thickness: 45, refractiveIndex: 1.0, semiDiameter: 12.5 }
          ]
        },
        variables: [{ surfaceIndex: 0, param: 'radius', min: 20, max: 100 }],
        operands: [{ type: 'PARAXIAL_FOCAL_LENGTH', targetMm: 50, weight: 1.0 }],
        options: {
          initialDamping: 0.1,
          minimumDamping: 1e-4,
          maximumDamping: 10,
          dampingReductionFactor: 2.0,
          dampingIncreaseFactor: 2.0,
          maxIterations: 5,
          tolerance: 1e-4,
          finiteDiffStep: 1e-5
        }
      });
      assert.strictEqual(dlsRes.success, true);

      const zmxRes = opticsIpcExports.runZmxImport({
        content:
          'SURF 1\n  CURV 0.02\n  DISZ 5.0\n  DIAM 10.0\n  CONI 0.0\nSURF 2\n  CURV -0.02\n  DISZ 45.0\n  DIAM 10.0\n  CONI 0.0\n'
      });
      assert.strictEqual(zmxRes.success, true);

      // Birefringent split to exercise vectorHasMagnitude
      opticsIpcExports.runPolarizationTrace({
        action: 'birefringent-split',
        crystalProps: { no: 1.5, ne: 1.6, opticAxis: [0, 0, 1] },
        rayDir: [0, 0.1, 0.99],
        surfaceNorm: [0, 0, 1]
      });

      // Invoke optics IPC handlers via handlers map
      await handlers.get('omni:get-lens-prescription')(trustedEvent, {});
      await handlers.get('omni:query-glass-catalog')(trustedEvent, {});
      await handlers.get('omni:run-optical-tolerancing')(trustedEvent, {});
      await handlers.get('omni:get-camera-lens-master')(trustedEvent, {});
      await handlers.get('omni:import-zmx-optics')(trustedEvent, {
        content:
          'SURF 1\n  CURV 0.02\n  DISZ 5.0\n  DIAM 10.0\n  CONI 0.0\nSURF 2\n  CURV -0.02\n  DISZ 45.0\n  DIAM 10.0\n  CONI 0.0\n'
      });
      passedTests++;
      console.log('  ✓ PASSED: All Optics IPC channels and calculation functions covered');
    }

    // 5. Headless Solver Daemon CLI & Operations
    currentSection = '[5/13] Headless Solver Daemon';
    console.log('\n[5] Headless Solver Daemon & CLI...');
    {
      const daemon = new HeadlessSolverDaemon();
      assert.strictEqual(HeadlessSolverDaemon.getHealth().status, 'experimental');

      // Instance dispatch
      const optRes = daemon.dispatchJob({
        type: 'optics',
        params: { n1: 1.0, n2: 1.5, thetaI: 0.5 }
      });
      assert.strictEqual(optRes.status, 'COMPUTED_EXPERIMENTAL');

      // Static solve across disciplines
      const plantSteam = HeadlessSolverDaemon.solveJob({
        discipline: 'plant',
        parameters: { type: 'steam', pressurePa: 1e6, temperatureK: 400 }
      });
      assert.strictEqual(plantSteam.status, 'COMPUTED_EXPERIMENTAL');

      const plantPinch = HeadlessSolverDaemon.solveJob({
        discipline: 'plant',
        parameters: {
          type: 'pinch',
          streams: [{ type: 'HOT', Tin: 150, Tout: 60, mCp: 10 }],
          deltaTmin: 10
        }
      });
      assert.strictEqual(plantPinch.status, 'COMPUTED_EXPERIMENTAL');

      const plantHammer = HeadlessSolverDaemon.solveJob({
        discipline: 'plant',
        parameters: {
          type: 'water_hammer',
          pipeLengthM: 1000,
          waveSpeedMs: 1200,
          initialFlowRateM3s: 0.5,
          initialHeadM: 100,
          closureTimeS: 2.0,
          steps: 5
        }
      });
      assert.strictEqual(plantHammer.status, 'UNAVAILABLE');

      const revA = {
        commitId: 'c1',
        units: { length: 'mm', volume: 'mm3' },
        volumeMm3: 1000,
        faces: [{ id: 'f1', centroidMm: { x: 0, y: 0, z: 0 } }]
      };
      const revB = {
        commitId: 'c2',
        units: { length: 'mm', volume: 'mm3' },
        volumeMm3: 1000,
        faces: [{ id: 'f1', centroidMm: { x: 0, y: 0, z: 0 } }]
      };
      const pdmDiff = HeadlessSolverDaemon.solveJob({
        discipline: 'pdm',
        parameters: {
          type: 'visual_diff',
          toleranceMm: 0.1,
          modificationThresholdMm: 0.5,
          revisionA: revA,
          revisionB: revB
        }
      });
      assert.strictEqual(pdmDiff.status, 'COMPUTED_EXPERIMENTAL');

      const pdmRollup = HeadlessSolverDaemon.solveJob({
        discipline: 'pdm',
        parameters: {
          bom: {
            partNumber: 'ROOT-001',
            name: 'Root',
            revision: 'A',
            quantity: 1,
            unitMassKg: 1,
            unitCostUsd: 100,
            children: []
          }
        }
      });
      assert.strictEqual(pdmRollup.status, 'COMPUTED_EXPERIMENTAL');

      const hpcSlurm = HeadlessSolverDaemon.solveJob({
        discipline: 'hpc',
        parameters: { type: 'slurm', nodes: 2, tasksPerNode: 8, timeLimit: '01:00:00' }
      });
      assert.strictEqual(hpcSlurm.status, 'COMPUTED_EXPERIMENTAL');

      const hpcPbs = HeadlessSolverDaemon.solveJob({
        discipline: 'hpc',
        parameters: { type: 'pbs', nodes: 2, tasksPerNode: 8, timeLimit: '01:00:00' }
      });
      assert.strictEqual(hpcPbs.status, 'COMPUTED_EXPERIMENTAL');

      const hpcRcb = HeadlessSolverDaemon.solveJob({
        discipline: 'hpc',
        parameters: {
          type: 'rcb',
          points: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1]
          ],
          numPartitions: 2
        }
      });
      assert.strictEqual(hpcRcb.status, 'COMPUTED_EXPERIMENTAL');

      const hpcFrontal = HeadlessSolverDaemon.solveJob({
        discipline: 'hpc',
        parameters: {
          type: 'plan_out_of_core',
          dofCount: 500,
          availableRamBytes: 1e9,
          assumptions: { matrixNonzerosPerDof: 10, factorEntriesPerDof: 30 }
        }
      });
      assert.strictEqual(hpcFrontal.status, 'COMPUTED_EXPERIMENTAL');

      const edaSta = HeadlessSolverDaemon.solveJob({
        discipline: 'eda',
        parameters: { corners: [{ name: 'typical', temperatureC: 25, voltageV: 1.2 }], paths: [] }
      });
      assert.strictEqual(edaSta.status, 'COMPUTED_EXPERIMENTAL');

      const ctrlMcdc = HeadlessSolverDaemon.solveJob({
        discipline: 'controls',
        parameters: { action: 'mcdc', conditions: ['A', 'B'], func: (a, b) => a && b }
      });
      assert.strictEqual(ctrlMcdc.status, 'COMPUTED_EXPERIMENTAL');

      const ctrlAutocode = HeadlessSolverDaemon.solveJob({
        discipline: 'controls',
        parameters: {
          action: 'autocode',
          name: 'FlightController',
          sampleRateHz: 100,
          A: [[-1]],
          B: [[1]],
          C: [[1]],
          K: [[0.5]]
        }
      });
      assert.strictEqual(ctrlAutocode.status, 'COMPUTED_EXPERIMENTAL');

      const ctrlUnsupp = HeadlessSolverDaemon.solveJob({
        discipline: 'controls',
        parameters: {}
      });
      assert.strictEqual(ctrlUnsupp.status, 'UNAVAILABLE');

      const robUnsupp = HeadlessSolverDaemon.solveJob({
        discipline: 'robotics',
        parameters: {}
      });
      assert.strictEqual(robUnsupp.status, 'UNAVAILABLE');

      const cfdSolve = HeadlessSolverDaemon.solveJob({
        discipline: 'cfd',
        parameters: { steps: 1, nx: 2, ny: 2, nz: 2, lx: 1, ly: 1, lz: 1, dt: 0.001, rho: 1, mu: 0.01 }
      });
      assert.strictEqual(cfdSolve.status, 'COMPUTED_EXPERIMENTAL');

      const feaSolve = HeadlessSolverDaemon.solveJob({
        discipline: 'fea',
        parameters: {
          nodes: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: 0, z: 1 }
          ],
          elements: [{ nodes: [0, 1, 2, 3], material: SYNTHETIC_LINEAR_ELASTIC_MATERIAL }]
        }
      });
      assert.strictEqual(feaSolve.status, 'COMPUTED_EXPERIMENTAL');

      const partSolve = HeadlessSolverDaemon.solveJob({
        discipline: 'partition',
        parameters: {
          nodes: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 },
            { x: 0, y: 0, z: 1 }
          ],
          elements: [[0, 1, 2, 3]],
          numPartitions: 2
        }
      });
      assert.strictEqual(partSolve.status, 'COMPUTED_EXPERIMENTAL');

      // CLI execution
      HeadlessSolverDaemon.runCLI(['--health']);

      const tmpSpec = path.join(os.tmpdir(), `headless_spec_${Date.now()}.json`);
      const tmpOut = path.join(os.tmpdir(), `headless_out_${Date.now()}.json`);
      fs.writeFileSync(
        tmpSpec,
        JSON.stringify({
          discipline: 'optics',
          parameters: { n1: 1.0, n2: 1.5, thetaI: 0.5 }
        }),
        'utf8'
      );
      HeadlessSolverDaemon.runCLI(['--solve', `--input=${tmpSpec}`, `--out=${tmpOut}`]);
      assert.strictEqual(fs.existsSync(tmpOut), true);

      try {
        if (fs.existsSync(tmpSpec)) fs.unlinkSync(tmpSpec);
        if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
      } catch (_) {}
      passedTests++;
      console.log('  ✓ PASSED: HeadlessSolverDaemon operations and CLI covered');
    }

    // 6. ComputeHostProcess Queue & Priority Sorting
    currentSection = '[6/13] ComputeHostProcess';
    console.log('\n[6] ComputeHostProcess Priority Sorting & Telemetry...');
    {
      const host = getComputeHost();
      assert(host instanceof ComputeHostProcess);

      // Submit LOW then HIGH to exercise comparator in _enqueue
      const jobLow = host.submitJob(
        'SPARSE_CHOLESKY',
        {
          n: 2,
          entries: [
            [0, 0, 4],
            [1, 1, 9]
          ],
          b: [4, 9]
        },
        { priority: 'LOW' }
      );
      const jobHigh = host.submitJob(
        'SPARSE_CHOLESKY',
        {
          n: 2,
          entries: [
            [0, 0, 4],
            [1, 1, 9]
          ],
          b: [4, 9]
        },
        { priority: 'HIGH' }
      );
      const jobNorm = host.submitJob(
        'SPARSE_CHOLESKY',
        {
          n: 2,
          entries: [
            [0, 0, 4],
            [1, 1, 9]
          ],
          b: [4, 9]
        },
        { priority: 'NORMAL' }
      );

      const telem = host.getTelemetry();
      assert(Number(telem.heapUsedMb) > 0);

      const [resLow, resHigh, resNorm] = await Promise.all([jobLow, jobHigh, jobNorm]);
      assert.strictEqual(resLow.success, true);
      assert.strictEqual(resHigh.success, true);
      assert.strictEqual(resNorm.success, true);
      passedTests++;
      console.log('  ✓ PASSED: ComputeHostProcess priority queue and execution covered');
    }

    // 7. Feature Maturity Helpers
    currentSection = '[7/13] Feature Maturity';
    console.log('\n[7] Feature Maturity Module Functions...');
    {
      assert.strictEqual(featureMaturity.isReleaseApproved('cae'), false);
      assert(Array.isArray(featureMaturity.listCorrelatedDomains()));
      assert(featureMaturity.getDomainMaturity('cad') !== null);
      assert(Array.isArray(featureMaturity.getAllDomainMaturity()));
      assert(featureMaturity.getMaturitySummary().totalDomains > 0);
      assert(Array.isArray(featureMaturity.getReleaseGatedDomains()));
      passedTests++;
      console.log('  ✓ PASSED: Feature maturity inquiry functions covered');
    }

    // 8. Other IPC Domain Callbacks
    currentSection = '[8/13] IPC callbacks';
    console.log('\n[8] Other IPC Domains: EDA, Controls & Stenographer Events...');
    {
      // EDA helper
      const stdCell = handleStandardCellLibraryRequest({});
      assert(stdCell.success !== undefined);

      // Stenographer daemon stream simulated callbacks
      const sup = new StenographerSupervisor();
      sup._handleDaemonLine('');
      sup._handleDaemonLine('    ');
      sup._handleDaemonLine('malformed json here');
      sup._handleDaemonLine('{"jsonrpc":"2.0","id":1,"result":{"status":"pong"}}');
      sup.emit('daemon:stderr', Buffer.from('test stderr log'));
      sup.emit('daemon:error', new Error('mock daemon error'));
      passedTests++;
      console.log('  ✓ PASSED: EDA, Controls and Stenographer event lines covered');
    }

    // 9. CAD Domain IPC Channels
    currentSection = '[9/13] CAD IPC';
    console.log('\n[9] CAD Domain IPC Channels & Helper Functions...');
    {
      // Primitives: box, cylinder, sphere
      const primBox = await handlers.get('omni:create-cad-primitive')(trustedEvent, {
        type: 'box',
        params: { width: 10, height: 20, depth: 30, units: 'mm' }
      });
      assert.strictEqual(primBox.success, true);
      assert.strictEqual(primBox.units, 'mm');
      assert(primBox.volumeMm3 > 0);

      const primCyl = await handlers.get('omni:create-cad-primitive')(trustedEvent, {
        type: 'cylinder',
        params: { radius: 5, height: 20, units: 'mm' }
      });
      assert.strictEqual(primCyl.success, true);
      assert(primCyl.volumeMm3 > 0);

      const primSph = await handlers.get('omni:create-cad-primitive')(trustedEvent, {
        type: 'sphere',
        params: { radius: 10, units: 'mm' }
      });
      assert.strictEqual(primSph.success, true);
      assert(primSph.volumeMm3 > 0);

      assert.throws(
        () => cadIpcExports.runCadPrimitive({ type: 'box', params: { width: 10, units: 'mm' } }),
        TypeError
      );
      assert.throws(
        () => cadIpcExports.runCadPrimitive({ type: 'cylinder', params: { radius: -5, height: 10, units: 'mm' } }),
        TypeError
      );

      // Export OBJ & STEP
      const objRes = await handlers.get('omni:export-cad-obj')(trustedEvent, {
        width: 10,
        height: 10,
        depth: 10,
        units: 'mm'
      });
      assert(typeof objRes === 'string' && objRes.includes('v '));

      const stepRes = await handlers.get('omni:export-step')(trustedEvent, {
        width: 10,
        height: 10,
        depth: 10,
        units: 'mm',
        name: 'ValidStepModel'
      });
      assert.strictEqual(stepRes.success, true);
      assert.strictEqual(stepRes.filename, 'ValidStepModel.step');
      assert(stepRes.stepText.includes('ISO-10303-21'));

      assert.throws(
        () =>
          cadIpcExports.runCadExportSTEP({
            width: 10,
            height: 10,
            depth: 10,
            units: 'mm',
            name: '123_invalid_start'
          }),
        TypeError
      );

      // NURBS Evaluation & Intersection
      const nurbsRes = await handlers.get('omni:evaluate-nurbs')(trustedEvent, {
        degree: 3,
        controlPoints: [
          [0, 0, 0],
          [1, 2, 0],
          [3, 2, 0],
          [4, 0, 0]
        ],
        u: 0.5
      });
      assert.strictEqual(nurbsRes.success, true);
      assert.strictEqual(nurbsRes.point.length, 3);
      assert.strictEqual(nurbsRes.tangent.length, 3);
      assert(nurbsRes.length > 0);

      const ssiRes = await handlers.get('omni:intersect-basic-nurbs-ssi')(trustedEvent, {
        z1: 5,
        width1: 20,
        height1: 20,
        y2: 10,
        width2: 20,
        height2: 20,
        subdivisions: 4,
        tolerance: 1e-4
      });
      assert.strictEqual(ssiRes.success, true);
      assert(Array.isArray(ssiRes.points));

      // Edge Blend: Fillet & Chamfer
      const filletRes = await handlers.get('omni:apply-edge-blend')(trustedEvent, {
        type: 'fillet',
        width: 20,
        height: 20,
        depth: 20,
        radius: 2.0
      });
      assert.strictEqual(filletRes.success, true);
      assert.strictEqual(filletRes.type, 'fillet');

      const chamferRes = await handlers.get('omni:apply-edge-blend')(trustedEvent, {
        type: 'chamfer',
        width: 20,
        height: 20,
        depth: 20,
        distance: 2.0
      });
      assert.strictEqual(chamferRes.success, true);
      assert.strictEqual(chamferRes.type, 'chamfer');

      // Assembly Mates
      const mateRes = await handlers.get('omni:solve-assembly-mates')(trustedEvent, {
        initX: 5,
        initY: 5,
        initZ: 20,
        targetZ: 10,
        maxIter: 20
      });
      assert.strictEqual(mateRes.success, true);
      assert(mateRes.result !== undefined);

      // 2D Drafting Sheet
      const draftRes = await handlers.get('omni:generate-drafting-sheet')(trustedEvent, {
        partName: 'MountingBracket',
        partNumber: 'MB-001',
        width: 50,
        height: 30,
        depth: 20,
        scale: '1:1',
        units: 'mm'
      });
      assert.strictEqual(draftRes.success, true);
      assert(typeof draftRes.svg === 'string');

      const draftErr = cadIpcExports.runDraftingSheet({
        partName: '',
        partNumber: 'MB-001',
        width: 50,
        height: 30,
        depth: 20,
        scale: '1:1',
        units: 'mm'
      });
      assert.strictEqual(draftErr.success, false);
      assert.strictEqual(draftErr.status, 'invalid-input');

      // Trimmed NURBS SSI
      const trimmedSsi = await handlers.get('omni:intersect-nurbs-ssi')(trustedEvent, {});
      assert.strictEqual(trimmedSsi.success, true);

      // Sheet Metal Unfolding
      await assert.rejects(
        () => handlers.get('omni:unfold-sheet-metal')(trustedEvent, {}),
        /Missing required object property 'bend'/
      );
      await assert.rejects(
        () =>
          handlers.get('omni:unfold-sheet-metal')(trustedEvent, {
            lengthUnit: 'mm',
            bend: { angleDeg: 90, innerRadiusMm: 2, thicknessMm: 2, direction: 'UP' },
            flanges: [
              { name: 'Flange1', lengthMm: 40, widthMm: 40 },
              { name: 'Flange2', lengthMm: 40, widthMm: 40 }
            ]
          }),
        /Missing required object property 'kFactor'/
      );
      const sheetRes = await handlers.get('omni:unfold-sheet-metal')(trustedEvent, {
        lengthUnit: 'mm',
        bend: { angleDeg: 90.0, innerRadiusMm: 2.0, thicknessMm: 2.0, kFactor: 0.44, direction: 'UP' },
        flanges: [
          { name: 'Flange1', lengthMm: 40, widthMm: 40 },
          { name: 'Flange2', lengthMm: 40, widthMm: 40 }
        ]
      });
      assert.strictEqual(sheetRes.success, true);
      assert(sheetRes.bendAllowanceMm > 0);

      // GD&T True Position
      const gdtRes = await handlers.get('omni:evaluate-gdt')(trustedEvent, {
        fcf: { specifiedTolerance: 0.2, materialCondition: 'MMC' },
        hole: {
          nominalX: 50.0,
          nominalY: 30.0,
          measuredX: 50.08,
          measuredY: 29.95,
          nominalDiameter: 10.0,
          measuredDiameter: 10.25,
          lowerTolerance: -0.3,
          upperTolerance: 0.3
        }
      });
      assert.strictEqual(gdtRes.success, true);

      // Variational Constraint Solver
      const sketchRes = await handlers.get('omni:solve-variational-sketch')(trustedEvent, {
        points: [
          { id: 'p1', x: 0, y: 0, fixed: true },
          { id: 'p2', x: 12, y: 0, fixed: false }
        ],
        constraints: [{ type: 'DISTANCE', pt1: 'p1', pt2: 'p2', value: 10 }]
      });
      assert.strictEqual(sketchRes.success, true);

      // Auto-Heal CAD Geometry
      const healRes = await handlers.get('omni:heal-cad-geometry')(trustedEvent, {
        dirtyModel: { vertices: [], faces: [] },
        options: { tolerance: 0.05 }
      });
      assert(healRes.success !== undefined);

      // Visual CAD Diff
      const rev1 = {
        commitId: 'rev1',
        units: { length: 'mm', volume: 'mm3' },
        volumeMm3: 1000,
        faces: [{ id: 'f1', centroidMm: { x: 0, y: 0, z: 0 } }]
      };
      const rev2 = {
        commitId: 'rev2',
        units: { length: 'mm', volume: 'mm3' },
        volumeMm3: 1050,
        faces: [{ id: 'f1', centroidMm: { x: 0.1, y: 0, z: 0 } }]
      };
      const diffRes = await handlers.get('omni:visual-diff-cad')(trustedEvent, {
        modelA: rev1,
        modelB: rev2,
        options: { toleranceMm: 0.1, modificationThresholdMm: 0.5 }
      });
      assert.strictEqual(diffRes.success, true);

      const diffRevRes = await handlers.get('omni:visual-diff-cad')(trustedEvent, {
        revA: rev1,
        revB: rev2,
        options: { toleranceMm: 0.1, modificationThresholdMm: 0.5 }
      });
      assert.strictEqual(diffRevRes.success, true);

      const diffErr = cadIpcExports.runVisualDiffCAD({
        modelA: rev1,
        revA: rev1,
        modelB: rev2,
        options: { toleranceMm: 0.1, modificationThresholdMm: 0.5 }
      });
      assert.strictEqual(diffErr.success, false);
      assert.strictEqual(diffErr.status, 'invalid-input');

      // Engineering BOM Rollup
      const ebomRoot = await handlers.get('omni:rollup-ebom')(trustedEvent, {
        rootAssembly: {
          partNumber: 'ASM-001',
          name: 'Main Assembly',
          quantity: 1,
          unitMassKg: 10.0,
          unitCostUsd: 250.0,
          children: []
        }
      });
      assert.strictEqual(ebomRoot.success, true);

      const ebomLegacy = await handlers.get('omni:rollup-ebom')(trustedEvent, {
        partNumber: 'SUB-001',
        name: 'SubAssembly',
        quantity: 2,
        unitMassKg: 5.0,
        unitCostUsd: 100.0,
        items: []
      });
      assert.strictEqual(ebomLegacy.success, true);

      const ebomErr = cadIpcExports.runEngineeringBOMRollup({});
      assert.strictEqual(ebomErr.success, false);
      assert.strictEqual(ebomErr.status, 'invalid-input');

      const ebomMissing = cadIpcExports.runEngineeringBOMRollup({ partNumber: 'P1' });
      assert.strictEqual(ebomMissing.success, false);
      assert.strictEqual(ebomMissing.status, 'invalid-input');

      // Standard Fasteners (unavailable route)
      const fastRes = await handlers.get('omni:get-standard-fastener')(trustedEvent, {});
      assert.strictEqual(fastRes.success, false);
      assert.strictEqual(fastRes.status, 'UNAVAILABLE');

      // Out-of-Core Spatial Octree LOD
      const lodRes = await handlers.get('omni:get-out-of-core-lod')(trustedEvent, {
        cameraPosition: [0, 0, 100],
        frustumBounds: [-100, -100, -100, 100, 100, 100]
      });
      assert.strictEqual(lodRes.success, true);

      // CAD Validation Properties: box, cylinder, invalid checks
      const valBox = await handlers.get('omni:compute-cad-validation-properties')(trustedEvent, {
        dx: 10,
        dy: 20,
        dz: 30,
        shapeType: 'box'
      });
      assert.strictEqual(valBox.success, true);
      assert(typeof valBox.bodyName === 'string');

      const valCyl = await handlers.get('omni:compute-cad-validation-properties')(trustedEvent, {
        dx: 10,
        dy: 10,
        dz: 30,
        radius: 5,
        shapeType: 'cylinder'
      });
      assert.strictEqual(valCyl.success, true);

      const valBadDim = await handlers.get('omni:compute-cad-validation-properties')(trustedEvent, {
        dx: -1,
        dy: 10,
        dz: 10
      });
      assert.strictEqual(valBadDim.success, false);

      const valBadShape = await handlers.get('omni:compute-cad-validation-properties')(trustedEvent, {
        dx: 10,
        dy: 10,
        dz: 10,
        shapeType: 'torus'
      });
      assert.strictEqual(valBadShape.success, false);

      const valBadRadius = await handlers.get('omni:compute-cad-validation-properties')(trustedEvent, {
        dx: 10,
        dy: 10,
        dz: 10,
        shapeType: 'cylinder',
        radius: -2
      });
      assert.strictEqual(valBadRadius.success, false);

      // Feature Operations: Extrude, Revolve, Shell
      const extRes = await handlers.get('omni:cad-extrude-profile')(trustedEvent, {
        profile: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 }
        ],
        depth: 25,
        draftAngleDeg: 0,
        lengthUnit: 'mm'
      });
      assert.strictEqual(extRes.success, true);
      assert(extRes.volume > 0);

      const revRes = await handlers.get('omni:cad-revolve-profile')(trustedEvent, {
        profile: [
          { x: 10, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 10 }
        ],
        angleDeg: 180,
        axis: 'Z',
        segments: 16,
        lengthUnit: 'mm'
      });
      assert.strictEqual(revRes.success, true);

      const shellRes = await handlers.get('omni:cad-shell-body')(trustedEvent, {
        width: 30,
        height: 30,
        depth: 30,
        wallThickness: 2,
        openFaceIndex: 0,
        lengthUnit: 'mm'
      });
      assert.strictEqual(shellRes.success, true);

      // CAM Toolpath & G-Code
      const camRes = await handlers.get('omni:cam-generate-toolpath')(trustedEvent, {
        options: {
          toolDiameter: 6.0,
          toolType: 'flat_endmill',
          feedRateMmMin: 500,
          plungeRateMmMin: 200,
          spindleRpm: 10000,
          stepoverMm: 3.0,
          stepdownMm: 2.0,
          safeZ: 15
        },
        bounds: { minX: -20, maxX: 20, minY: -20, maxY: 20, minZ: 0, maxZ: 10 },
        programNumber: 'O2002'
      });
      assert.strictEqual(camRes.success, true);
      assert(camRes.totalGcodeLines > 0);

      // Rocket feature tree (unavailable route)
      const rktRes = await handlers.get('omni:get-rocket-feature-tree')(trustedEvent, {});
      assert.strictEqual(rktRes.success, false);
      assert.strictEqual(rktRes.status, 'unavailable');

      passedTests++;
      console.log('  ✓ PASSED: All 23 CAD IPC channels and calculation functions covered');
    }

    // 10. Controls & Aerospace Domain IPC Channels
    currentSection = '[10/13] Controls and Aerospace IPC';
    console.log('\n[10] Controls & Aerospace Domain IPC Channels & Calculation Functions...');
    {
      // Unavailable legacy routes
      const prop = await handlers.get('omni:solve-propeller')(trustedEvent, {});
      assert.strictEqual(prop.success, false);
      assert.strictEqual(prop.status, 'unavailable');

      const drone = await handlers.get('omni:simulate-drone')(trustedEvent, {});
      assert.strictEqual(drone.success, false);
      assert.strictEqual(drone.status, 'unavailable');

      // Block diagram simulation
      const validBlockUnits = {
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
      };
      const blockDiagRes = await handlers.get('omni:simulate-block-diagram')(trustedEvent, {
        graphData: {
          blocks: [
            {
              id: 'b_step',
              type: 'source_step',
              params: { stepTime: 0.1, initialValue: 0, finalValue: 1 },
              x: 0,
              y: 0
            },
            { id: 'b_gain', type: 'gain', params: { k: 2.5 }, x: 50, y: 0 },
            { id: 'b_scope', type: 'scope', params: {}, x: 100, y: 0 }
          ],
          connections: [
            { fromBlock: 'b_step', toBlock: 'b_gain' },
            { fromBlock: 'b_gain', toBlock: 'b_scope' }
          ]
        },
        tEnd: 0.5,
        dt: 0.05,
        units: validBlockUnits
      });
      assert.strictEqual(blockDiagRes.status, 'experimental');

      // validateBlockDiagramGraph helper coverage with all block types
      controlsIpcExports.validateBlockDiagramGraph({
        blocks: [
          { id: 's_sine', type: 'source_sine', params: { frequency: 1.0, amplitude: 1.0 } },
          { id: 's_const', type: 'source_constant', params: { value: 5.0 } },
          { id: 's_sum', type: 'sum', params: {} },
          {
            id: 's_pid',
            type: 'pid',
            params: { kp: 1.0, ki: 0.1, kd: 0.01, initialState: 0.0, limitMin: -10, limitMax: 10 }
          }
        ],
        connections: []
      });

      assert.throws(() => controlsIpcExports.validateBlockDiagramGraph(null), TypeError);
      assert.throws(() => controlsIpcExports.validateBlockDiagramGraph({ blocks: [], connections: [] }), TypeError);
      assert.throws(
        () =>
          controlsIpcExports.validateBlockDiagramGraph({
            blocks: [
              { id: 'pid1', type: 'pid', params: { kp: 1, ki: 1, kd: 1, initialState: 0, limitMin: 10, limitMax: -10 } }
            ],
            connections: []
          }),
        TypeError
      );

      // Bode frequency response
      const bode = await handlers.get('omni:solve-bode')(trustedEvent, {
        numCoeffs: [1],
        denCoeffs: [1, 2, 1],
        omegaMin: 0.1,
        omegaMax: 100,
        points: 20
      });
      assert(Array.isArray(bode.bodePoints) && bode.bodePoints.length === 20);

      // Multi-rate & algebraic loop (unavailable routes)
      const sched = await handlers.get('omni:schedule-multi-rate')(trustedEvent, {});
      assert.strictEqual(sched.success, false);
      assert.strictEqual(sched.status, 'unavailable');

      const alg = await handlers.get('omni:solve-algebraic-loop')(trustedEvent, {});
      assert.strictEqual(alg.success, false);
      assert.strictEqual(alg.status, 'unavailable');

      // LQR synthesis
      const lqr = await handlers.get('omni:synthesize-lqr')(trustedEvent, {
        A: [
          [0, 1],
          [0, 0]
        ],
        B: [[0], [1]],
        Q: [
          [1, 0],
          [0, 1]
        ],
        R: [[1]],
        maxIter: 50,
        tolerance: 1e-6
      });
      assert.strictEqual(lqr.success, true);

      // Autocode C / Rust
      const autocode = await handlers.get('omni:autocode-controller')(trustedEvent, {
        modelSpec: {
          name: 'FlightController',
          A: [
            [-1, 0.5],
            [0, -2]
          ],
          B: [[0], [1]],
          C: [[1, 0]],
          K: [[0.5, 1.0]],
          sampleRateHz: 100
        }
      });
      assert.strictEqual(autocode.success, true);
      assert(typeof autocode.cCode.sourceCode === 'string' && autocode.cCode.sourceCode.includes('FlightController'));

      // MPC QP solver
      const mpc = await handlers.get('omni:solve-mpc')(trustedEvent, {
        options: {
          A: [
            [1, 0.1],
            [0, 1]
          ],
          B: [[0], [0.1]],
          C: [[1, 0]],
          predictionHorizon: 4,
          controlHorizon: 2,
          Q: [1],
          R: [0.1],
          Rdelta: [0.01],
          uMin: [-10],
          uMax: [10],
          deltaUMax: [2],
          initialControl: [0]
        },
        x0: [1, 0],
        yRef: [0]
      });
      assert.strictEqual(mpc.success, true);

      // Simscape DAE motor simulation
      const simscape = await handlers.get('omni:simulate-simscape-dae')(trustedEvent, {
        R: 2.0,
        L: 0.5,
        Kt: 0.1,
        Ke: 0.1,
        J: 0.02,
        b: 0.01,
        V_step: 12.0,
        totalTimeSec: 0.05,
        dt: 0.005,
        initialCurrentAmps: 0.0,
        initialAngularVelocityRadS: 0.0
      });
      assert.strictEqual(simscape.success, true);

      // MC/DC & FMI (unavailable routes)
      const mcdc = await handlers.get('omni:evaluate-mcdc-coverage')(trustedEvent, {});
      assert.strictEqual(mcdc.success, false);
      assert.strictEqual(mcdc.status, 'unavailable');

      const fmi = await handlers.get('omni:run-fmi-cosimulation')(trustedEvent, {});
      assert.strictEqual(fmi.success, false);
      assert.strictEqual(fmi.status, 'unavailable');

      // AUTOSAR SWC generator
      const arxml = await handlers.get('omni:generate-autosar-swc')(trustedEvent, {
        modelSpec: {
          name: 'AutosarYawSWC',
          A: [[-1]],
          B: [[1]],
          C: [[1]],
          K: [[0.5]],
          sampleRateHz: 50
        }
      });
      assert.strictEqual(arxml.success, true);

      // Robotics kinematics
      const robFk = await handlers.get('omni:run-robotics-operation')(trustedEvent, {
        operation: 'forward_kinematics',
        parameters: { preset: 'UR5E', jointAnglesRad: [0, 0, 0, 0, 0, 0] }
      });
      assert.strictEqual(robFk.success, true);
      assert.strictEqual(robFk.status, 'COMPLETED');

      // Aerospace routes: NASA rocket multi-branch & spacecraft spec
      const nasaEmpty = await handlers.get('omni:solve-nasa-rocket')(trustedEvent, {});
      assert.strictEqual(nasaEmpty.success, false);
      assert.strictEqual(nasaEmpty.error.code, 'UNSUPPORTED');

      const nasaNozzle = await handlers.get('omni:solve-nasa-rocket')(trustedEvent, {
        chamberPressurePa: 5e6,
        expansionRatio: 16,
        throatAreaM2: 0.05
      });
      assert.strictEqual(nasaNozzle.success, true);
      assert(Number.isFinite(nasaNozzle.exitMach) && nasaNozzle.exitMach > 1);

      const nasaCfd = await handlers.get('omni:solve-nasa-rocket')(trustedEvent, {
        machNumber: 2.0,
        deflectionAngleDeg: 8,
        chordM: 1
      });
      assert.strictEqual(nasaCfd.success, true);
      assert(Number.isFinite(nasaCfd.cl));

      const nasaOrb = await handlers.get('omni:solve-nasa-rocket')(trustedEvent, {
        r1Meters: 6778000,
        r2Meters: 42164000
      });
      assert.strictEqual(nasaOrb.success, true);
      assert(nasaOrb.deltaVTotal > 0);

      const spacecraft = await handlers.get('omni:get-nasa-spacecraft-spec')(trustedEvent, {});
      assert.strictEqual(spacecraft.success, false);
      assert.strictEqual(spacecraft.error.code, 'UNSUPPORTED');

      // Compile rocket nozzle
      const nozzleRes = await handlers.get('omni:compile-rocket-nozzle')(trustedEvent, {
        chamberPressurePa: 6e6,
        throatAreaM2: 0.04,
        expansionRatio: 20
      });
      assert.strictEqual(nozzleRes.success, true);
      assert(Number.isFinite(nozzleRes.exitMach) && nozzleRes.exitMach > 1);
      assert(Array.isArray(nozzleRes.contour) && nozzleRes.contour.length >= 32);
      assert(Number.isFinite(nozzleRes.thrustN) && nozzleRes.thrustN > 0);
      await assert.rejects(async () => handlers.get('omni:compile-rocket-nozzle')(trustedEvent, {}));

      // Aerospace CFD
      const cfdRes = await handlers.get('omni:run-aerospace-cfd')(trustedEvent, {
        machNumber: 3.0,
        angleOfAttackDeg: 4.0,
        altitudeM: 15000,
        deflectionAngleDeg: 10,
        chordM: 2
      });
      assert.strictEqual(cfdRes.success, true);
      assert(Number.isFinite(cfdRes.cl) && Number.isFinite(cfdRes.cd) && Number.isFinite(cfdRes.cm));
      await assert.rejects(async () => handlers.get('omni:run-aerospace-cfd')(trustedEvent, {}));

      // Orbital transfer
      const orbRes = await handlers.get('omni:calculate-orbital-transfer')(trustedEvent, {
        r1Meters: 7000000,
        r2Meters: 42000000
      });
      assert.strictEqual(orbRes.success, true);
      assert(orbRes.deltaVTotal > 0);
      assert(orbRes.timeOfFlightS > 0);
      await assert.rejects(async () => handlers.get('omni:calculate-orbital-transfer')(trustedEvent, {}));

      passedTests++;
      console.log('  ✓ PASSED: All 19 Controls & Aerospace IPC channels and functions covered');
    }

    // 11. Plant Domain IPC Channels
    currentSection = '[11/13] Plant IPC';
    console.log('\n[11] Plant Domain IPC Channels & Calculation Functions...');
    {
      const sampleComponentProperties = {
        methane: {
          criticalTemperatureK: 190.56,
          criticalPressurePa: 45.99e5,
          molecularWeightKgPerMol: 0.01604,
          acentricFactor: 0.011,
          provenance: { source: 'NIST WebBook', license: 'Public Domain' }
        },
        ethane: {
          criticalTemperatureK: 305.32,
          criticalPressurePa: 48.72e5,
          molecularWeightKgPerMol: 0.03007,
          acentricFactor: 0.099,
          provenance: { source: 'NIST WebBook', license: 'Public Domain' }
        }
      };

      // HYSYS / Wilson VLE flash
      const flashRes = await handlers.get('omni:solve-hysys-flash')(trustedEvent, {
        feedComposition: { methane: 0.5, ethane: 0.5 },
        tempC: -100,
        pressureBar: 5.0,
        componentProperties: sampleComponentProperties
      });
      assert.strictEqual(flashRes.converged, true);

      const flashMissing = await handlers.get('omni:solve-hysys-flash')(trustedEvent, {});
      assert.strictEqual(flashMissing.success, false);
      assert.strictEqual(flashMissing.status, 'unavailable');

      // Distillation (unavailable)
      const distRes = await handlers.get('omni:simulate-distillation')(trustedEvent, {});
      assert.strictEqual(distRes.success, false);
      assert.strictEqual(distRes.status, 'unavailable');

      // ASME B31.3 Piping Stress
      const pipeRes = await handlers.get('omni:evaluate-piping-stress')(trustedEvent, {
        pipeOuterDiameterMm: 114.3,
        nominalWallThicknessMm: 6.02,
        youngsModulusGPa: 200,
        thermalExpansionPerK: 1.2e-5,
        designPressureBar: 20.0,
        operatingTempC: 150,
        ambientTempC: 20,
        straightLengthM: 10.0,
        hasExpansionLoop: false,
        corrosionAllowanceMm: 1.5
      });
      assert.strictEqual(pipeRes.success, true);

      // VLE Phase Envelope
      const vleRes = await handlers.get('omni:get-vle-envelope')(trustedEvent, {
        composition: { methane: 0.5, ethane: 0.5 },
        pMinBar: 1.0,
        pMaxBar: 10.0,
        points: 5,
        componentProperties: sampleComponentProperties,
        tMinC: -120,
        tMaxC: 50
      });
      assert.strictEqual(vleRes.status, 'experimental-estimate');
      assert(Array.isArray(vleRes.points));

      const vleMissing = await handlers.get('omni:get-vle-envelope')(trustedEvent, {});
      assert.strictEqual(vleMissing.success, false);
      assert.strictEqual(vleMissing.status, 'unavailable');

      // Column profile & flowsheet & DIPPR (unavailable routes)
      const colProf = await handlers.get('omni:get-column-profile')(trustedEvent, {});
      assert.strictEqual(colProf.success, false);
      assert.strictEqual(colProf.status, 'unavailable');

      const flowRes = await handlers.get('omni:solve-flowsheet')(trustedEvent, {});
      assert.strictEqual(flowRes.success, false);
      assert.strictEqual(flowRes.status, 'unavailable');

      const dippr = await handlers.get('omni:query-dippr-database')(trustedEvent, {});
      assert.strictEqual(dippr.success, false);
      assert.strictEqual(dippr.status, 'unavailable');

      // VLLE flash & MESH distillation & Water hammer (unavailable routes)
      const vlle = await handlers.get('omni:solve-vlle-flash')(trustedEvent, {});
      assert.strictEqual(vlle.success, false);
      assert.strictEqual(vlle.status, 'unavailable');

      const meshDist = await handlers.get('omni:solve-mesh-distillation')(trustedEvent, {});
      assert.strictEqual(meshDist.success, false);
      assert.strictEqual(meshDist.status, 'unavailable');

      const hammer = await handlers.get('omni:solve-water-hammer-moc')(trustedEvent, {});
      assert.strictEqual(hammer.success, false);
      assert.strictEqual(hammer.status, 'unavailable');

      // Peng-Robinson 1978 Flash
      const prFlash = await handlers.get('omni:flash-peng-robinson')(trustedEvent, {
        components: [
          {
            name: 'Methane',
            criticalTemperatureK: 190.56,
            criticalPressurePa: 45.99e5,
            acentricFactor: 0.011,
            provenance: { source: 'NIST Chemistry WebBook', license: 'Public Domain' }
          },
          {
            name: 'Ethane',
            criticalTemperatureK: 305.32,
            criticalPressurePa: 48.72e5,
            acentricFactor: 0.099,
            provenance: { source: 'NIST Chemistry WebBook', license: 'Public Domain' }
          }
        ],
        k_ij: [
          [0, 0],
          [0, 0]
        ],
        z: [0.7, 0.3],
        T: 200,
        P: 20e5,
        maxIter: 30,
        tol: 1e-5
      });
      assert.strictEqual(prFlash.success, true);

      const prMissing = await handlers.get('omni:flash-peng-robinson')(trustedEvent, {});
      assert.strictEqual(prMissing.success, false);
      assert.strictEqual(prMissing.status, 'unavailable');

      // TEMA Bell-Delaware Heat Exchanger Rating
      const temaRes = await handlers.get('omni:rate-tema-heat-exchanger')(trustedEvent, {
        geom: { Ds: 0.5, do: 0.02, Pt: 0.025, L: 3.0, B: 0.3, Bc: 0.25, Nt: 200 },
        fluid: { massFlow: 10.0, rho: 998.0, mu: 0.001, Cp: 4184.0, k: 0.6 }
      });
      assert.strictEqual(temaRes.success, true);

      const temaMissing = await handlers.get('omni:rate-tema-heat-exchanger')(trustedEvent, {});
      assert.strictEqual(temaMissing.success, false);
      assert.strictEqual(temaMissing.status, 'unavailable');

      // API 520 Relief Valve Sizing
      const prvRes = await handlers.get('omni:size-api520-prv')(trustedEvent, {
        massFlow: 5.0,
        P1: 10e5,
        Pb: 1e5,
        T: 350,
        M: 28.97,
        k: 1.4
      });
      assert.strictEqual(prvRes.success, true);

      const prvMissing = await handlers.get('omni:size-api520-prv')(trustedEvent, {});
      assert.strictEqual(prvMissing.success, false);
      assert.strictEqual(prvMissing.status, 'unavailable');

      // NRTL Activity (unavailable)
      const nrtl = await handlers.get('omni:plant-nrtl-activity')(trustedEvent, {});
      assert.strictEqual(nrtl.success, false);
      assert.strictEqual(nrtl.status, 'unavailable');

      // eNRTL CO2 Capture
      const enrtlRes = await handlers.get('omni:evaluate-enrtl-co2')(trustedEvent, {
        temperatureK: 313.15,
        meaMassFraction: 0.3,
        co2Loading: 0.35,
        richLoading: 0.48,
        leanLoading: 0.2,
        liquidFlowKgH: 100000.0
      });
      assert.strictEqual(enrtlRes.success, true);

      const enrtlMissing = await handlers.get('omni:evaluate-enrtl-co2')(trustedEvent, {});
      assert.strictEqual(enrtlMissing.success, false);
      assert.strictEqual(enrtlMissing.status, 'unavailable');

      // Cryogenic Loading
      const cryoRes = await handlers.get('omni:solve-cryogenic-loading')(trustedEvent, {});
      assert(cryoRes !== undefined);

      // Steam Properties (IAPWS-IF97)
      const steamMPa = await handlers.get('omni:calculate-steam-properties')(trustedEvent, {
        pressureMPa: 1.0,
        temperatureK: 450
      });
      assert.strictEqual(steamMPa.success, true);
      assert(steamMPa.densityKgM3 > 0);

      const steamPa = await handlers.get('omni:calculate-steam-properties')(trustedEvent, {
        pressurePa: 1e6,
        temperatureK: 450
      });
      assert.strictEqual(steamPa.success, true);

      await assert.rejects(async () => handlers.get('omni:calculate-steam-properties')(trustedEvent, {}));

      // Helpers
      assert.strictEqual(plantIpcExports.getPlantPropertyCatalogUnavailableResult().status, 'unavailable');
      assert.strictEqual(plantIpcExports.getVlleFlashUnavailableResult().status, 'unavailable');

      passedTests++;
      console.log('  ✓ PASSED: All 17 Plant IPC channels and helper functions covered');
    }

    // 12. EDA Domain IPC Channels
    currentSection = '[12/13] EDA IPC';
    console.log('\n[12] EDA Domain IPC Channels & Calculation Functions...');
    {
      // Verilog logic synthesis
      const vLogRes = await handlers.get('omni:synthesize-verilog')(
        trustedEvent,
        'module my_and(a, b, y);\ninput a, b;\noutput y;\nassign y = a & b;\nendmodule'
      );
      assert.strictEqual(vLogRes.success, true);

      const vLogEmpty = await handlers.get('omni:synthesize-verilog')(trustedEvent, '');
      assert.strictEqual(vLogEmpty.success, false);
      assert.strictEqual(vLogEmpty.status, 'invalid-input');

      // DRC
      const drcRes = await handlers.get('omni:run-drc')(trustedEvent, {
        shapes: [
          { id: 's1', layer: 'metal1', x: 0, y: 0, w: 2.0, h: 10.0 },
          { id: 's2', layer: 'metal1', x: 5, y: 0, w: 2.0, h: 10.0 }
        ],
        rules: { minWidth: 1.0, minSpacing: 1.0, minArea: 5.0 }
      });
      assert.strictEqual(drcRes.success, true);

      // LVS
      const lvsRes = await handlers.get('omni:run-lvs')(trustedEvent, {
        schematic: { gates: [{ id: 'i1', cell: 'AND2' }] },
        layout: { cells: [{ id: 'i1', cell: 'AND2' }] }
      });
      assert.strictEqual(lvsRes.success, true);

      // RS-274X Gerber export
      const gerberRes = await handlers.get('omni:export-gerber')(trustedEvent, {
        traces: [{ x1: 0, y1: 0, x2: 10, y2: 0, widthMm: 0.25 }],
        pads: [{ x: 0, y: 0, shape: 'round', diameterMm: 1.0 }],
        vias: [{ x: 5, y: 0, outerDiameterMm: 0.8 }],
        solderMaskOpenings: [{ x: 0, y: 0, shape: 'round', diameterMm: 1.1 }],
        holes: [{ x: 0, y: 0, diameterMm: 0.4 }],
        boardOutline: { outlineWidthMm: 0.2, xMin: 0, yMin: 0, xMax: 50, yMax: 50 }
      });
      assert.strictEqual(gerberRes.success, true);

      // SPICE transient analysis
      const spiceRes = await handlers.get('omni:solve-spice-circuit')(trustedEvent, {
        analysis: { type: 'transient', stopTimeS: 1e-4, stepS: 1e-6 },
        components: [
          { type: 'voltage_source', id: 'V1', nPlus: 'in', nMinus: '0', dcVoltageV: 5.0 },
          { type: 'resistor', id: 'R1', n1: 'in', n2: 'out', resistanceOhm: 1000 },
          { type: 'capacitor', id: 'C1', n1: 'out', n2: '0', capacitanceF: 1e-6, initialVoltageV: 0.0 }
        ]
      });
      assert.strictEqual(spiceRes.success, true);

      // SystemVerilog AST inspection
      const svRes = await handlers.get('omni:synthesize-system-verilog')(trustedEvent, {
        code: 'module reg_counter(input logic clk, output logic [3:0] q); endmodule'
      });
      assert.strictEqual(svRes.success, true);

      // Clock tree synthesis & PathFinder routing
      const clockRes = await handlers.get('omni:synthesize-clock-tree')(trustedEvent, {
        sinks: [
          { id: 'sinkA', x: 10, y: 10, capPf: 0.05 },
          { id: 'sinkB', x: 20, y: 20, capPf: 0.05 }
        ],
        rootPosition: { x: 15, y: 15 },
        options: {
          targetSkewPs: 50,
          bufferDelayNs: 0.1,
          wireResistancePerUm: 0.01,
          wireCapacitancePerUmPf: 0.0002
        },
        routingGrid: { width: 30, height: 30, layers: 2 },
        routeStart: { x: 0, y: 0, layer: 0 },
        routeEnd: { x: 5, y: 5, layer: 0 }
      });
      assert.strictEqual(clockRes.success, true);

      // BSIM4 compact model & Inverter VTC
      const bsimRes = await handlers.get('omni:solve-bsim4-vtc')(trustedEvent, {
        nmos: {
          type: 'nmos',
          W: 1e-6,
          L: 130e-9,
          tox: 4e-9,
          Vth0: 0.4,
          mu0: 0.05,
          vsat: 1e5,
          dibl_eta: 0.05,
          lambda: 0.02
        },
        pmos: {
          type: 'pmos',
          W: 2e-6,
          L: 130e-9,
          tox: 4e-9,
          Vth0: -0.4,
          mu0: 0.02,
          vsat: 8e4,
          dibl_eta: 0.05,
          lambda: 0.02
        },
        bias: { vgsV: 1.2, vdsV: 1.2, vbsV: 0.0 },
        vddV: 1.2,
        sweepPoints: 10
      });
      assert.strictEqual(bsimRes.success, true);

      // GDSII export and import
      const gdsExport = await handlers.get('omni:export-gdsii')(trustedEvent, {
        libName: 'TESTLIB',
        userUnits: 1e-3,
        dbUnits: 1e-9,
        topCell: 'TOP',
        polygons: [
          {
            layer: 1,
            datatype: 0,
            points: [
              { x: 0, y: 0 },
              { x: 1000, y: 0 },
              { x: 1000, y: 1000 }
            ]
          }
        ]
      });
      assert.strictEqual(gdsExport.success, true);
      assert(typeof gdsExport.base64 === 'string');

      const gdsImport = await handlers.get('omni:import-gdsii')(trustedEvent, Buffer.from(gdsExport.base64, 'base64'));
      assert.strictEqual(gdsImport.success, true);

      // MCMM static timing analysis
      const mcmmRes = await handlers.get('omni:run-mcmm-sta')(trustedEvent, {
        clockPeriodNs: 10.0,
        logicDelayTypNs: 4.0,
        clockSkewNs: 0.2,
        tCqTypNs: 0.5,
        tSetupTypNs: 0.3,
        tHoldTypNs: 0.2,
        corners: [{ name: 'slow', voltage: 1.08, temperatureC: 125, processScale: 1.2 }]
      });
      assert.strictEqual(mcmmRes.success, true);

      // 3D Parasitic extraction
      const pexRes = await handlers.get('omni:extract-pex-3d')(trustedEvent, {
        lengthUm: 100,
        widthUm: 0.5,
        thicknessUm: 0.2,
        spacingUm: 0.5,
        dielectricHeightUm: 1.0,
        dielectricPermittivity: 3.9,
        resistivityOhmM: 2.8e-8
      });
      assert.strictEqual(pexRes.success, true);

      // Place & Route
      const pnrRes = await handlers.get('omni:eda-place-and-route')(trustedEvent, {
        options: { coreWidth: 100, coreHeight: 100, stdCellHeight: 10 },
        cells: [
          { id: 'c1', width: 10, height: 10 },
          { id: 'c2', width: 10, height: 10 }
        ],
        nets: [{ name: 'net1', pins: ['c1', 'c2'] }]
      });
      assert.strictEqual(pnrRes.success, true);

      // Sky130 PDK standard cell compatibility (unavailable route)
      const pdkUnavailable = await handlers.get('omni:eda-sky130-pdk')(trustedEvent, {
        action: 'get-cells'
      });
      assert.strictEqual(pdkUnavailable.success, false);
      assert.strictEqual(pdkUnavailable.status, 'unavailable');

      // LEF parser
      const lefSample = `VERSION 5.8 ;
    LAYER m1
      TYPE ROUTING ;
      WIDTH 0.14 ;
    END m1
    MACRO inv_cell
      CLASS CORE ;
      SIZE 1.0 BY 2.0 ;
    END inv_cell
    END LIBRARY`;
      const lefRes = await handlers.get('omni:eda-parse-lef')(trustedEvent, {
        content: lefSample
      });
      assert.strictEqual(lefRes.success, true);
      assert(lefRes.macroCount > 0);

      // DEF parser
      const defSample = `VERSION 5.8 ;
    DESIGN test_chip ;
    UNITS DISTANCE MICRONS 1000 ;
    DIEAREA ( 0 0 ) ( 1000 1000 ) ;
    COMPONENTS 1 ;
      - inst1 inv_cell + PLACED ( 100 100 ) N ;
    END COMPONENTS
    NETS 1 ;
      - net1 ( inst1 in ) ;
    END NETS
    END DESIGN`;
      const defRes = await handlers.get('omni:eda-parse-def')(trustedEvent, {
        content: defSample
      });
      assert.strictEqual(defRes.success, true);
      assert.strictEqual(defRes.name, 'test_chip');

      // DEF serializer
      const defSerRes = await handlers.get('omni:eda-serialize-def')(trustedEvent, {
        defData: {
          name: 'test_chip',
          unitsDistanceMicrons: 1000,
          dieArea: { x1: 0, y1: 0, x2: 1000, y2: 1000 },
          components: [{ id: 'inst1', macro: 'inv_cell', status: 'PLACED', x: 100, y: 100, orientation: 'N' }],
          nets: [{ name: 'net1', connections: [{ instance: 'inst1', pin: 'A' }], routedSegments: [] }]
        }
      });
      assert.strictEqual(defSerRes.success, true);
      assert(defSerRes.defText.includes('DESIGN test_chip'));

      // Ignition circuit simulation (unavailable route)
      const ignitionRes = await handlers.get('omni:simulate-asi-ignition')(trustedEvent, {});
      assert.strictEqual(ignitionRes.success, false);
      assert.strictEqual(ignitionRes.error.code, 'UNSUPPORTED');

      // Helper functions branch coverage
      assert.strictEqual(edaIpcExports.handleVerilogSynthesisRequest('').success, false);
      assert.strictEqual(edaIpcExports.handleSystemVerilogInspectionRequest('').success, false);
      assert.strictEqual(edaIpcExports.handleLefParseRequest({ content: '' }).success, false);
      assert.strictEqual(edaIpcExports.handleDefParseRequest({ content: '' }).success, false);
      assert.strictEqual(edaIpcExports.handleDefSerializeRequest({ defData: null }).success, false);
      assert.strictEqual(edaIpcExports.handleGerberExportRequest({}).success, false);
      assert.strictEqual(edaIpcExports.handleDrcRequest({}).success, false);
      assert.strictEqual(edaIpcExports.handleGdsiiExportRequest({}).success, false);
      assert.strictEqual(edaIpcExports.handleGdsiiImportRequest(null).success, false);
      assert.strictEqual(edaIpcExports.handleClockTreeRequest({}).success, false);
      assert.strictEqual(edaIpcExports.handleBsim4VtcRequest({}).success, false);
      assert.strictEqual(edaIpcExports.handlePlaceAndRouteRequest({}).success, false);

      const { getExperimentalEdaLibraryExample } = require('./support/experimental_eda_library_example');
      const delayMissing = edaIpcExports.handleStandardCellLibraryRequest({
        action: 'compute-delay',
        library: getExperimentalEdaLibraryExample()
      });
      assert.strictEqual(delayMissing.success, false);
      assert.strictEqual(delayMissing.status, 'invalid-input');

      passedTests++;
      console.log('  ✓ PASSED: All 18 EDA IPC channels and helper functions covered');
    }

    // 13. Remaining Optics IPC Channels
    currentSection = '[13/13] Remaining Optics IPC';
    console.log('\n[13] Remaining Optics IPC Channels & Calculation Functions...');
    {
      // Paraxial scalar metrics
      const optMetrics = await handlers.get('omni:solve-optics')(trustedEvent, {
        focalLengthMm: 50.0,
        fStop: 1.8,
        subjectDistM: 2.0,
        wavelengthNm: 550,
        circleOfConfusionMm: 0.03
      });
      assert(optMetrics !== null);

      // Skew ray trace
      const surfacesSample = [
        {
          radius: 50,
          zVertex: 0,
          clearRadius: 10,
          nIncident: 1.0,
          nTransmitted: 1.5,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        },
        {
          radius: -50,
          zVertex: 5,
          clearRadius: 10,
          nIncident: 1.5,
          nTransmitted: 1.0,
          conic: 0,
          asphericCoeffs: [0, 0, 0, 0]
        }
      ];
      const rayTraceRes = await handlers.get('omni:trace-rays')(trustedEvent, {
        surfaces: surfacesSample,
        entrancePupilRadiusMm: 5,
        pupilPlaneZMm: 0,
        wavelengthUm: 0.55,
        numRings: 2,
        raysPerRing: 4,
        fieldAngleDeg: 0,
        sensorZMm: 50
      });
      assert.strictEqual(rayTraceRes.success, true);
      assert(rayTraceRes.rays !== undefined);

      // Skew optics MTF & Spot
      const skewRes = await handlers.get('omni:solve-skew-optics')(trustedEvent, {
        surfaces: surfacesSample,
        entrancePupilRadiusMm: 5,
        pupilPlaneZMm: 0,
        wavelengthUm: 0.55,
        numRings: 2,
        raysPerRing: 4,
        fieldAngleDeg: 0,
        sensorZMm: 50,
        fStop: 2.8,
        maxFrequencyLpMm: 100
      });
      assert.strictEqual(skewRes.success, true);
      assert(Array.isArray(skewRes.mtfData.frequencies));

      // Aspheric Freeform Optics
      const asphRes = await handlers.get('omni:evaluate-aspheric-optics')(trustedEvent, {
        curvaturePerMm: 0.02,
        conic: -1.0,
        semiDiameterMm: 25,
        coefficients: { alpha4: 1e-6, alpha6: 1e-9, alpha8: 0, alpha10: 0, alpha12: 0 },
        evaluationRadiusMm: 10,
        normalPointMm: { x: 5, y: 5 },
        vertexZMm: 0,
        rayOriginMm: { x: 0, y: 5, z: -10 },
        rayDirection: { x: 0, y: 0, z: 1 },
        maxIterations: 20,
        toleranceMm: 1e-6
      });
      assert.strictEqual(asphRes.success, true);
      assert(asphRes.sagMm !== undefined);

      // Dielectric Thin-Film Coating
      const filmRes = await handlers.get('omni:evaluate-thin-film-coating')(trustedEvent, {
        substrateIndex: 1.52,
        incidentIndex: 1.0,
        layers: [{ refractiveIndex: 1.38, thicknessNm: 100 }],
        wavelengthNm: 550,
        thetaDeg: 0
      });
      assert.strictEqual(filmRes.success, true);
      assert(filmRes.result.reflectance !== undefined && filmRes.result.transmittance !== undefined);

      // Optical Thermal Soak & CTE Expansion
      const soakRes = await handlers.get('omni:evaluate-optical-thermal-soak')(trustedEvent, {
        housingCtePerK: 23e-6,
        housingCteSource: 'Aluminum 6061-T6 Spec',
        elements: [
          {
            radius1Mm: 50,
            radius2Mm: -50,
            thicknessMm: 5,
            airGapMm: 2,
            refractiveIndexAtReferenceTemperature: 1.5168,
            thermalProperties: {
              D0PerK: 1.86e-6,
              D1PerK2: 1.31e-8,
              D2PerK3: -1.37e-11,
              E0Um2PerK: 4.34e-7,
              E1Um2PerK2: 6.27e-10,
              lambdaTkUm: 0.17,
              glassCtePerK: 7.1e-6,
              source: 'SCHOTT N-BK7 Datasheet'
            }
          }
        ],
        targetTempC: 60,
        referenceTempC: 20,
        wavelengthUm: 0.5876,
        pressurePa: 101325
      });
      assert.strictEqual(soakRes.success, true);

      // 2D FFT Wavefront PSF & MTF
      const psfRes = await handlers.get('omni:evaluate-wavefront-psf')(trustedEvent, {
        gridSize: 32,
        wavelengthUm: 0.55,
        fNumber: 4.0,
        defocusWaves: 0.25,
        sphericalWaves: 0.1
      });
      assert.strictEqual(psfRes.success, true);
      assert(psfRes.result.strehlRatio > 0);

      // DLS merit function optimization
      const dlsOptRes = await handlers.get('omni:optimize-optical-dls')(trustedEvent, {
        system: {
          initialRefractiveIndex: 1.0,
          metricSampling: {
            entrancePupilRadiusMm: 10,
            paraxialRayHeightMm: 10,
            zonalRayFraction: 0.707,
            chiefRayAngleRad: 0.1
          },
          surfaces: [
            { radius: 50, thickness: 5, refractiveIndex: 1.5, semiDiameter: 12.5 },
            { radius: -50, thickness: 45, refractiveIndex: 1.0, semiDiameter: 12.5 }
          ]
        },
        variables: [{ surfaceIndex: 0, param: 'radius', min: 20, max: 100 }],
        operands: [{ type: 'PARAXIAL_FOCAL_LENGTH', targetMm: 50, weight: 1.0 }],
        options: {
          initialDamping: 1.0,
          minimumDamping: 1e-4,
          maximumDamping: 1e4,
          dampingReductionFactor: 2.0,
          dampingIncreaseFactor: 2.0,
          maxIterations: 3,
          tolerance: 1e-6,
          finiteDiffStep: 1e-4
        }
      });
      assert.strictEqual(dlsOptRes.success, true);

      // Polarization Ray Tracing: Fresnel & Stokes
      const polFresnel = await handlers.get('omni:trace-polarization-ray')(trustedEvent, {
        action: 'fresnel',
        n1: 1.0,
        n2: 1.5,
        thetaDeg: 45
      });
      assert.strictEqual(polFresnel.success, true);

      const polStokes = await handlers.get('omni:trace-polarization-ray')(trustedEvent, {
        action: 'stokes',
        Ex: 1.0,
        Ey: 0.0,
        ExImag: 0.0,
        EyImag: 0.0
      });
      assert.strictEqual(polStokes.success, true);

      // Helpers
      assert.strictEqual(opticsIpcExports.getOpticalGlassCatalogUnavailableResult().status, 'unavailable');
      assert.strictEqual(opticsIpcExports.getOpticalTolerancingUnavailableResult().status, 'unavailable');

      const invalidOpt = opticsIpcExports.runAsphericOptics({});
      assert.strictEqual(invalidOpt.success, false);
      assert.strictEqual(invalidOpt.status, 'invalid-input');

      const numFail = opticsIpcExports.runThinFilmCoating({
        substrateIndex: 1.5,
        incidentIndex: 1.0,
        layers: [{ refractiveIndex: 1e150, thicknessNm: 1e150 }],
        wavelengthNm: 1e-10,
        thetaDeg: 89.999999
      });
      assert.strictEqual(numFail.success, false);
      assert.strictEqual(numFail.status, 'numerical-failure');

      passedTests++;
      console.log('  ✓ PASSED: All 9 remaining Optics IPC channels and helper functions covered');
    }
  } catch (error) {
    failedTests++;
    console.error(`  ✗ FAILED: ${currentSection}`);
    console.error(error?.stack || error);
  }

  const totalTests = passedTests + failedTests;
  console.log('\n================================================================');
  console.log(`       MAIN IPC COVERAGE: ${passedTests}/${totalTests} sections passed; ${failedTests} failed`);
  console.log('================================================================');
  return { total: totalTests, passed: passedTests, failed: failedTests };
}

if (require.main === module) {
  runMainIpcCoverageTests()
    .then((stats) => {
      if (stats.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('Test suite setup failed:', error?.stack || error);
      process.exitCode = 1;
    });
}

module.exports = { runMainIpcCoverageTests };
