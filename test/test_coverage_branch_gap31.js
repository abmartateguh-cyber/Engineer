'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 31).
 *
 * Targets uncovered branch blocks in the system IPC router (valid-payload
 * handler bodies for SBOM generation, enterprise IAM, feature maturity,
 * claims gate, AI train/predict/gradient, HPC local dispatch, materials
 * query, and project operations plus per-handler fail paths), the renderer
 * orchestration layer (src/ui/app.js executed with DOM stubs), the 3D
 * viewport (constructor/options, camera-control branches, load/export and
 * error paths with real THREE scenes and stub renderers), the STEP
 * translator (entity parsing branches, unsupported entities, round-trip and
 * PMI/trim handling), the robotics engine adapter (the 6-operation execute
 * matrix with accept/reject paths and URDF parse branches), the storage
 * layer (v3 trailer/stream error paths, WAL write/fsync failure paths,
 * encrypted path branches), and the stenographer supervisor (daemon
 * lifecycle, proposal approval/rejection, signed ledger states). No
 * production source is modified.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');
const vm = require('vm');
const zlib = require('zlib');

const REPO_ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-gap31-'));

function tmpFile(name) {
  return path.join(TMP, name);
}

// ===========================================================================
// Browser environment stubs (FakeElement pattern) used by UI modules.
// Set up before requiring any renderer module.
// ===========================================================================
const elementRegistry = new Map();
const domListeners = {};

function createMockElement(tag = 'div', id = '') {
  const children = [];
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    id: id || '',
    className: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: {},
    hidden: false,
    disabled: false,
    value: '',
    width: 800,
    height: 500,
    clientWidth: 800,
    clientHeight: 500,
    children,
    parentElement: null,
    closest: () => null,
    getAttribute: () => null,
    setAttribute: () => {},
    hasAttribute: () => false,
    removeAttribute: () => {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild: (c) => {
      if (c) {
        c.parentElement = el;
        children.push(c);
      }
      return c;
    },
    append: (...nodes) => {
      nodes.forEach((x) => {
        if (x && typeof x === 'object') {
          x.parentElement = el;
          children.push(x);
        }
      });
    },
    replaceChildren: (...nodes) => {
      children.length = 0;
      el.textContent = '';
      nodes.forEach((x) => {
        if (x && typeof x === 'object') {
          x.parentElement = el;
          children.push(x);
        }
      });
    },
    querySelector: (sel) => {
      if (String(sel).startsWith('#')) {
        const targetId = String(sel).slice(1);
        if (!elementRegistry.has(targetId)) elementRegistry.set(targetId, createMockElement('div', targetId));
        const found = elementRegistry.get(targetId);
        el.appendChild(found);
        return found;
      }
      return children[0] || null;
    },
    querySelectorAll: () => [],
    addEventListener: (type, cb) => {
      (listeners[type] = listeners[type] || []).push(cb);
    },
    removeEventListener: (type, cb) => {
      if (listeners[type]) listeners[type] = listeners[type].filter((fn) => fn !== cb);
    },
    dispatchEvent: (type, ev = {}) => {
      if (listeners[type]) {
        listeners[type].forEach((fn) =>
          fn({
            type,
            preventDefault: () => {},
            stopPropagation: () => {},
            clientX: 200,
            clientY: 150,
            button: 0,
            ...ev
          })
        );
      }
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }),
    getContext: () => ({
      save: () => {},
      restore: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      ellipse: () => {},
      roundRect: () => {},
      fillText: () => {},
      setLineDash: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {},
      measureText: () => ({ width: 10 })
    })
  };
  return el;
}

global.window = global;
global.window.__OMNI_TEST_MODE__ = true;

global.document = {
  getElementById: (id) => {
    if (!elementRegistry.has(id)) elementRegistry.set(id, createMockElement('div', id));
    return elementRegistry.get(id);
  },
  createElement: (tag) => createMockElement(tag),
  createTextNode: (text) => {
    const node = createMockElement('span');
    node.textContent = String(text);
    return node;
  },
  createDocumentFragment: () => createMockElement('fragment'),
  querySelector: (sel) =>
    sel && String(sel).startsWith('#') ? global.document.getElementById(String(sel).slice(1)) : null,
  querySelectorAll: () => [],
  get body() {
    if (!elementRegistry.has('__body__')) elementRegistry.set('__body__', createMockElement('body', '__body__'));
    return elementRegistry.get('__body__');
  },
  get activeElement() {
    return elementRegistry.get('__active__') || null;
  },
  addEventListener: (type, cb) => {
    (domListeners[type] = domListeners[type] || []).push(cb);
  },
  removeEventListener: (type, cb) => {
    if (domListeners[type]) domListeners[type] = domListeners[type].filter((fn) => fn !== cb);
  }
};

global.addEventListener = (type, cb) => global.document.addEventListener(type, cb);
global.removeEventListener = (type, cb) => global.document.removeEventListener(type, cb);
global.window.addEventListener = global.document.addEventListener;
global.window.removeEventListener = global.document.removeEventListener;
global.window.dispatchEvent = (type, ev = {}) => {
  if (domListeners[type]) {
    domListeners[type].forEach((fn) =>
      fn({ type, preventDefault: () => {}, stopPropagation: () => {}, clientX: 200, clientY: 150, ...ev })
    );
  }
};
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.cancelAnimationFrame = clearTimeout;
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
try {
  Object.defineProperty(global, 'navigator', {
    value: { gpu: { requestAdapter: async () => ({ limits: {} }) } },
    configurable: true,
    writable: true
  });
} catch (_) {
  global.window.navigator = { gpu: { requestAdapter: async () => ({ limits: {} }) } };
}
global.THREE = require('three');

// Permissive stub controllers for renderer modules that app.js references.
function makeStubController() {
  const handler = function () {
    return makeStubController();
  };
  return new Proxy(handler, {
    get: (_, prop) => {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'then') return undefined;
      return makeStubController();
    },
    apply: () => makeStubController(),
    construct: () => makeStubController()
  });
}
global.Viewport3D = makeStubController;
global.BlockDiagramUI = makeStubController;
global.SchematicLayoutUI = makeStubController;
global.OmniIcons = { hydrateAll: () => {} };
global.OmniSafeDOM = { appendSafeInlineMarkup: () => {} };
global.OmniCommandPaletteView = { createCommandPaletteItem: () => makeStubController() };
global.OmniWorkspaceTabView = { createWorkspaceTab: () => makeStubController() };
global.KeymapManager = makeStubController;
global.DockingManager = makeStubController;
global.SpaceMouseController = makeStubController;
global.OmniPropertyGridView = { createPropertyGridElements: () => [] };
global.OpticalInspectorUI = makeStubController;
global.PIDStudioUI = makeStubController;
global.SpiceOscilloscopeUI = makeStubController;
global.FlowsheetPfdUI = makeStubController;
global.OmniBodeChartModel = makeStubController;
global.OmniEdaResultView = makeStubController;
global.OmniEngineeringResultView = makeStubController;
global.StorytellingRails = { createController: () => makeStubController() };
global.OmniMaterialsCatalogView = { mount: () => {} };
global.OmniOpticsGlassLookupView = { mount: () => {} };
global.OmniAiSurrogateTrainerView = { mount: () => {} };
global.OmniHpcLocalDispatchView = { mount: () => {} };

// Viewport and STEP/robotics/storage modules loaded once globals exist.
const { Viewport3D } = require('../src/ui/viewport3d');
const { StepTranslator } = require('../src/core/cad/step_translator');
const {
  RoboticsEngineAdapter,
  PRESET_REGISTRY,
  SUPPORTED_OPERATIONS
} = require('../src/core/robotics/robotics_engine_adapter');
const { JobRequest } = require('../src/core/contracts/JobRequest');
const {
  OmniArchive,
  OmniArchiveV2,
  OmniArchiveV3,
  CommandJournal,
  OmniVaultAES256,
  OmniWal,
  WAL_MAGIC,
  WAL_VERSION,
  WAL_FILE_NAME,
  calculateCRC32,
  saveAtomicSync,
  MAGIC_BYTES,
  MAGIC_BYTES_V1,
  MAGIC_BYTES_V2,
  MAGIC_BYTES_V3,
  MAX_UNCOMPRESSED_SECTION_SIZE
} = require('../src/core/storage/omni_archive');
const { activeProjectManager } = require('../src/core/storage/project_manager');
const { StenographerSupervisor, LedgerEntry } = require('../src/main/stenographer_supervisor');
const { ToolDefinition } = require('../src/core/contracts/ToolDefinition');
const { NurbsCurve2D, TrimLoop2D, TrimmedNurbsSurface } = require('../src/core/cad/nurbs_trimmed_surface');

// ===========================================================================
// Electron mock + require hook for the main-process IPC router.
// ===========================================================================
const handlers = new Map();
const electronMock = {
  app: { getAppPath: () => REPO_ROOT },
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler)
  },
  dialog: {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true })
  }
};

const originalModuleLoad = Module._load;
Module._load = function loadWithElectronMock(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalModuleLoad.call(this, request, parent, isMain);
};
let defineHandlerModule;
let registerSystemIpc;
try {
  defineHandlerModule = require('../src/main/ipc/define_handler');
  ({ registerSystemIpc } = require('../src/main/ipc/system_ipc'));
} finally {
  Module._load = originalModuleLoad;
}

const entryUrl = pathToFileURL(path.join(REPO_ROOT, 'src', 'index.html')).href;
const trustedEvent = {
  sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
  senderFrame: { frameTreeNodeId: 42, url: entryUrl }
};

function registerIpc(deps) {
  defineHandlerModule.channelRegistry.clear();
  handlers.clear();
  defineHandlerModule.withIpcMain(electronMock.ipcMain, () => registerSystemIpc(deps));
}

const IPC_DEPS = {
  hpcEngine: {
    getClusterStatus: () => ({ success: true, provider: 'local', nodes: 4, status: 'ONLINE' }),
    setMembership: (active) => ({ success: true, active }),
    submitSimulationJob: (jobType, params, ranks) => ({ success: true, jobId: 'hpc_1', jobType, ranks })
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
    recordAction: (author, actionType, details) => ({ id: 7, author, actionType, details }),
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
  }
};

// ===========================================================================
// Suite
// ===========================================================================
async function runBranchGapThirtyOneCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const tasks = [];

  function check(name, fn) {
    totalTests++;
    tasks.push(async () => {
      try {
        await fn();
        passedTests++;
        console.log(`  ✓ PASSED: ${name}`);
      } catch (err) {
        failedTests++;
        console.error(`  ✗ FAILED: ${name}`);
        console.error(`    ${err.message}`);
      }
    });
  }

  // ------------------------------------------------------------------
  // system_ipc.js: valid-payload handler bodies and fail paths
  // ------------------------------------------------------------------
  check('System IPC: feature maturity and community samples', async () => {
    registerIpc(IPC_DEPS);
    const mat = await handlers.get('omni:get-feature-maturity')(trustedEvent);
    assert.strictEqual(mat.success, true);
    assert(mat.domains && typeof mat.domains === 'object');
    const samples = await handlers.get('omni:get-community-samples')(trustedEvent);
    assert.strictEqual(samples.success, undefined);
    assert(Array.isArray(samples));
    const accel = await handlers.get('omni:get-accelerator-info')(trustedEvent);
    assert.strictEqual(accel.success, true);
    assert(accel.activeTier && typeof accel.activeTier === 'string');
    const sys = await handlers.get('omni:get-system-info')(trustedEvent);
    assert.strictEqual(sys.tier, 'Local Workstation');
    assert.strictEqual(typeof sys.platform, 'string');
    assert.strictEqual(typeof sys.arch, 'string');
  });

  check('System IPC: AI train/predict/gradient success paths', async () => {
    registerIpc(IPC_DEPS);
    const train = await handlers.get('omni:ai-train-surrogate')(trustedEvent, {
      dataset: { inputs: [[0], [1], [0.5]], outputs: [[0], [1], [0.5]] },
      config: { epochs: 3, seed: 7, hiddenUnits: [3], batchSize: 2, learningRate: 0.1, momentum: 0.9 }
    });
    assert.strictEqual(train.success, true);
    assert.strictEqual(train.mode, 'neural-network-mlp');
    assert.strictEqual(train.trainingSamples, 3);
    assert(Array.isArray(train.lossHistory));
    const predict = await handlers.get('omni:ai-predict-surrogate')(trustedEvent, {
      model: train.model,
      x: [[0.5], [1]]
    });
    assert.strictEqual(predict.success, true);
    assert.strictEqual(predict.predictions.length, 2);
    const grad = await handlers.get('omni:ai-gradient-check')(trustedEvent, {
      model: train.model,
      x: [[0.5]],
      y: [[0.5]],
      options: { maxChecks: 4, eps: 1e-4, threshold: 1e-3 }
    });
    assert.strictEqual(grad.success, true);
    assert.strictEqual(typeof grad.passed, 'boolean');
  });

  check('System IPC: AI train/predict/gradient fail paths', async () => {
    registerIpc(IPC_DEPS);
    const badDataset = await handlers.get('omni:ai-train-surrogate')(trustedEvent, {
      dataset: { inputs: [[0]], outputs: [[0], [1]] }
    });
    assert.strictEqual(badDataset.success, false);
    assert.strictEqual(badDataset.error.code, 'INVALID_INPUT');
    const badConfig = await handlers.get('omni:ai-train-surrogate')(trustedEvent, {
      dataset: { inputs: [[0], [1]], outputs: [[0], [1]] },
      config: { epochs: -2 }
    });
    assert.strictEqual(badConfig.success, false);
    const badModel = await handlers.get('omni:ai-predict-surrogate')(trustedEvent, {
      model: { format: 'nope' },
      x: [[1]]
    });
    assert.strictEqual(badModel.success, false);
    const badGrad = await handlers.get('omni:ai-gradient-check')(trustedEvent, {
      model: { format: 'nope' },
      x: [[1]],
      y: [[1]]
    });
    assert.strictEqual(badGrad.success, false);
  });

  check('System IPC: claims gate legacy macro prompt', async () => {
    registerIpc(IPC_DEPS);
    const empty = await handlers.get('omni:ai-process-prompt')(trustedEvent, { prompt: '   ' });
    assert.strictEqual(empty.success, false);
    const ok = await handlers.get('omni:ai-process-prompt')(trustedEvent, { prompt: 'compute beam bending' });
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.mode, 'legacy-macro-adapter');
    assert.strictEqual(ok.requiresApproval, false);
  });

  check('System IPC: SBOM generation success and error paths', async () => {
    registerIpc(IPC_DEPS);
    const report = await handlers.get('omni:generate-sbom')(trustedEvent, {});
    assert.strictEqual(report.success, true);
    assert.strictEqual(report.validationLevel, 'experimental');
    assert(report.manifestDigest && /^[a-f0-9]{64}$/.test(report.manifestDigest));
    assert.strictEqual(typeof report.cyclonedxComponentCount, 'number');
  });

  check('System IPC: enterprise IAM and keymap branches', async () => {
    registerIpc(IPC_DEPS);
    const iam = await handlers.get('omni:iam-evaluate-access')(trustedEvent, { subject: 'x' });
    assert.strictEqual(iam.success, false);
    assert.strictEqual(iam.error.code, 'UNSUPPORTED');
    const keys = await handlers.get('omni:get-keymap-profiles')(trustedEvent);
    assert.strictEqual(keys.success, true);
    assert(keys.profiles.includes('CATIA'));
    const keysEmpty = await handlers.get('omni:get-keymap-profiles')(trustedEvent);
    assert.strictEqual(keysEmpty.success, true);
  });

  check('System IPC: materials catalog query branches', async () => {
    registerIpc(IPC_DEPS);
    const all = await handlers.get('omni:materials-catalog-query')(trustedEvent, {});
    assert.strictEqual(all.success, true);
    assert.strictEqual(all.available, true);
    assert(all.cards.length > 0);
    assert.strictEqual(all.referenceTemperatureK, 293);
    const filtered = await handlers.get('omni:materials-catalog-query')(trustedEvent, {
      search: 'steel',
      temperatureK: 473
    });
    assert.strictEqual(filtered.success, true);
    assert(filtered.count <= all.count);
    for (const card of filtered.cards) {
      assert(Number.isFinite(card.EAtTemperatureKPa), 'interpolated E must be finite');
    }
    const none = await handlers.get('omni:materials-catalog-query')(trustedEvent, { search: 'zzz-nonexistent' });
    assert.strictEqual(none.count, 0);
    const legacyList = await handlers.get('omni:get-materials-list')(trustedEvent);
    assert.strictEqual(legacyList.success, false);
    assert.strictEqual(legacyList.status, 'UNAVAILABLE');
  });

  check('System IPC: package/load archive and SHA-256 hashing', async () => {
    registerIpc(IPC_DEPS);
    const pkg = await handlers.get('omni:package-omni-archive')(trustedEvent, {
      projectName: 'gap31',
      sections: { notes: 'data', mesh: Buffer.from([1, 2, 3]) }
    });
    assert.strictEqual(pkg.success, true);
    assert.strictEqual(pkg.sectionCount, 3);
    assert.strictEqual(pkg.filename, 'gap31.omni');
    await assert.rejects(
      () => handlers.get('omni:load-omni-archive')(trustedEvent, 'not-buffer'),
      /Buffer\/Uint8Array/
    );
    const bogus = Buffer.alloc(16);
    const loadBad = await handlers.get('omni:load-omni-archive')(trustedEvent, bogus);
    assert.strictEqual(loadBad.success, false);
    assert.strictEqual(loadBad.error.code, 'INVALID_INPUT');
    const hash = await handlers.get('omni:hash-artifact-sha256')(trustedEvent, {
      content: 'engineering probe artifact'
    });
    assert.strictEqual(hash.success, true);
    assert.strictEqual(hash.sha256.length, 64);
    const hashEmpty = await handlers.get('omni:hash-artifact-sha256')(trustedEvent, { content: '' });
    assert.strictEqual(hashEmpty.success, false);
  });

  check('System IPC: generic sparse solve and PCG/dense solve branches', async () => {
    registerIpc(IPC_DEPS);
    const sparse = await handlers.get('omni:solve-generic-sparse')(trustedEvent, {
      A: { rows: 2, cols: 2, values: [4, 1, 1, 3] },
      b: [1, 2]
    });
    assert.strictEqual(sparse.success, true);
    assert(Math.abs(sparse.solution[0] - 1 / 11) < 1e-9);
    const sparseBad = await handlers.get('omni:solve-generic-sparse')(trustedEvent, {
      A: [[1, 2]],
      b: [1, 2]
    });
    assert.strictEqual(sparseBad.success, false);
    const gauss = await handlers.get('omni:solve-pcg-dense')(trustedEvent, {
      method: 'gaussian',
      A: [
        [4, 1],
        [1, 3]
      ],
      b: [1, 2]
    });
    assert.strictEqual(gauss.success, true);
    assert.strictEqual(gauss.method, 'gaussian');
    const pcg = await handlers.get('omni:solve-pcg-dense')(trustedEvent, {
      method: 'pcg',
      A: [
        [4, 1],
        [1, 3]
      ],
      b: [1, 2]
    });
    assert.strictEqual(pcg.success, true);
    const pcgBad = await handlers.get('omni:solve-pcg-dense')(trustedEvent, {
      method: 'pcg',
      A: [[1, 2]],
      b: [1, 2]
    });
    assert.strictEqual(pcgBad.success, false);
    await assert.rejects(
      () =>
        handlers.get('omni:solve-pcg-dense')(trustedEvent, {
          method: 'pcg',
          A: [
            [4, 1],
            [1, 3]
          ],
          b: [1, NaN]
        }),
      /finite number/
    );
  });

  check('System IPC: Radau IIA solve branches', async () => {
    registerIpc(IPC_DEPS);
    const decay = await handlers.get('omni:solve-radau-iia')(trustedEvent, {
      system: 'decay',
      t0: 0,
      y0: [1],
      tEnd: 1
    });
    assert.strictEqual(decay.success, true);
    assert(decay.trajectory.length > 3);
    const van = await handlers.get('omni:solve-radau-iia')(trustedEvent, {
      system: 'vanderpol',
      t0: 0,
      y0: [2, 0],
      tEnd: 0.5,
      rtol: 1e-6,
      atol: 1e-8
    });
    assert.strictEqual(van.success, true);
    await assert.rejects(
      () => handlers.get('omni:solve-radau-iia')(trustedEvent, { system: 'nope', t0: 0, y0: [1], tEnd: 1 }),
      /must be one of decay, vanderpol/
    );
    const badRange = await handlers.get('omni:solve-radau-iia')(trustedEvent, {
      system: 'decay',
      t0: 0,
      y0: [1],
      tEnd: 0
    });
    assert.strictEqual(badRange.success, false);
    const badDim = await handlers.get('omni:solve-radau-iia')(trustedEvent, {
      system: 'decay',
      t0: 0,
      y0: [1, 2],
      tEnd: 1
    });
    assert.strictEqual(badDim.success, false);
  });

  check('System IPC: HPC cluster, submit job, and compute host branches', async () => {
    registerIpc(IPC_DEPS);
    const status = await handlers.get('omni:get-cluster-status')(trustedEvent);
    assert.strictEqual(status.success, true);
    const member = await handlers.get('omni:set-membership')(trustedEvent, true);
    assert.strictEqual(member.active, true);
    const submitGood = await handlers.get('omni:submit-hpc-job')(trustedEvent, {
      jobType: 'thermal',
      params: {},
      ranks: 2
    });
    assert.strictEqual(submitGood.success, true);
    const submitBad = await handlers.get('omni:submit-hpc-job')(trustedEvent, { jobType: '', params: {}, ranks: 0 });
    assert.strictEqual(submitBad.success, false);
    const tel = await handlers.get('omni:get-compute-telemetry')(trustedEvent);
    assert.strictEqual(tel.success, true);
    const cancelMissing = await handlers.get('omni:cancel-compute-job')(trustedEvent, { jobId: 'nope' });
    assert.strictEqual(cancelMissing.success, true);
    assert.strictEqual(cancelMissing.cancelled, false);
    const submitComputeBad = await handlers.get('omni:submit-compute-job')(trustedEvent, { taskType: '', payload: {} });
    assert.strictEqual(submitComputeBad.success, false);
  });

  check('System IPC: no-provider fail paths', async () => {
    registerIpc({});
    const status = await handlers.get('omni:get-cluster-status')(trustedEvent);
    assert.strictEqual(status.success, false);
    assert.strictEqual(status.status, 'UNCONFIGURED');
    const member = await handlers.get('omni:set-membership')(trustedEvent, true);
    assert.strictEqual(member.success, false);
    const submit = await handlers.get('omni:submit-hpc-job')(trustedEvent, {
      jobType: 'thermal',
      params: {},
      ranks: 2
    });
    assert.strictEqual(submit.success, false);
    assert.strictEqual(submit.error.code, 'UNSUPPORTED');
    const audit = await handlers.get('omni:audit-record-action')(trustedEvent, { author: 'u', actionType: 't' });
    assert.strictEqual(audit.success, false);
    const vv = await handlers.get('omni:run-vv-benchmarks')(trustedEvent);
    assert.strictEqual(vv.success, false);
    const gold = await handlers.get('omni:run-100-gold-benchmarks')(trustedEvent);
    assert.strictEqual(gold.success, false);
    const sign = await handlers.get('omni:pkcs11-sign-payload')(trustedEvent, { payload: 'x' });
    assert.strictEqual(sign.success, false);
    const verify = await handlers.get('omni:pkcs11-verify-signature')(trustedEvent, {
      payload: 'x',
      signatureHex: 'aa'
    });
    assert.strictEqual(verify.success, false);
  });

  check('System IPC: audit ledger and HSM provider paths', async () => {
    registerIpc(IPC_DEPS);
    const audit = await handlers.get('omni:audit-record-action')(trustedEvent, {
      author: 'engineer',
      actionType: 'EDIT'
    });
    assert.strictEqual(audit.success, true);
    assert.strictEqual(audit.entry.author, 'engineer');
    assert.strictEqual(audit.chainIntegrity.valid, true);
    const signBad = await handlers.get('omni:pkcs11-sign-payload')(trustedEvent, { payload: '' });
    assert.strictEqual(signBad.success, false);
    const signGood = await handlers.get('omni:pkcs11-sign-payload')(trustedEvent, { payload: 'data' });
    assert.strictEqual(signGood.success, true);
    const verifyBad = await handlers.get('omni:pkcs11-verify-signature')(trustedEvent, { payload: 1 });
    assert.strictEqual(verifyBad.success, false);
    const verifyGood = await handlers.get('omni:pkcs11-verify-signature')(trustedEvent, {
      payload: 'data',
      signatureHex: 'aa'
    });
    assert.strictEqual(verifyGood.success, true);
    const vv = await handlers.get('omni:run-vv-benchmarks')(trustedEvent);
    assert.strictEqual(vv.success, true);
    const gold = await handlers.get('omni:run-100-gold-benchmarks')(trustedEvent);
    assert.strictEqual(gold.success, true);
    assert.strictEqual(gold.suite, 'extended');
  });

  check('System IPC: security validation and vault encrypt/decrypt', async () => {
    registerIpc(IPC_DEPS);
    const sanitized = await handlers.get('omni:security-validate-input')(trustedEvent, {
      payload: { safe: 1, polluted: { toString: 'x' } }
    });
    assert.strictEqual(sanitized.success, true);
    const enc = await handlers.get('omni:vault-encrypt-project')(trustedEvent, {
      password: 'correct-horse-battery',
      payload: { project: 'gap31' }
    });
    assert.strictEqual(enc.success, true);
    assert.strictEqual(enc.isEncrypted, true);
    const dec = await handlers.get('omni:vault-decrypt-project')(trustedEvent, {
      password: 'correct-horse-battery',
      encryptedBase64: enc.encryptedBase64
    });
    assert.strictEqual(dec.success, true);
    assert.deepStrictEqual(dec.payload, { project: 'gap31' });
    const encBad = await handlers.get('omni:vault-encrypt-project')(trustedEvent, { password: 'short', payload: {} });
    assert.strictEqual(encBad.success, false);
    const decNoPass = await handlers.get('omni:vault-decrypt-project')(trustedEvent, {
      password: '',
      encryptedBase64: enc.encryptedBase64
    });
    assert.strictEqual(decNoPass.success, false);
    const decBoth = await handlers.get('omni:vault-decrypt-project')(trustedEvent, {
      password: 'correct-horse-battery',
      encryptedBase64: enc.encryptedBase64,
      encryptedBytes: Buffer.from('x')
    });
    assert.strictEqual(decBoth.success, false);
    const decBad64 = await handlers.get('omni:vault-decrypt-project')(trustedEvent, {
      password: 'correct-horse-battery',
      encryptedBase64: 'not base64!'
    });
    assert.strictEqual(decBad64.success, false);
    await assert.rejects(
      () =>
        handlers.get('omni:vault-decrypt-project')(trustedEvent, {
          password: 'wrong-password-here',
          encryptedBase64: enc.encryptedBase64
        }),
      /Decryption Failed/
    );
    const decTampered = Buffer.from(enc.encryptedBase64, 'base64');
    decTampered[decTampered.length - 1] ^= 0x01;
    await assert.rejects(
      () =>
        handlers.get('omni:vault-decrypt-project')(trustedEvent, {
          password: 'correct-horse-battery',
          encryptedBytes: decTampered
        }),
      /Decryption Failed/
    );
  });

  check('System IPC: design wizard branches', async () => {
    registerIpc(IPC_DEPS);
    const drone = await handlers.get('omni:run-design-wizard')(trustedEvent, { wizardType: 'drone' });
    assert.strictEqual(drone.success, false);
    assert.strictEqual(drone.status, 'unavailable');
    const unknown = await handlers.get('omni:run-design-wizard')(trustedEvent, { wizardType: 'nope' });
    assert.strictEqual(unknown.success, false);
    const ok = await handlers.get('omni:run-design-wizard')(trustedEvent, { wizardType: 'test_wiz', inputs: { a: 1 } });
    assert.strictEqual(ok.success, true);
    assert.strictEqual(ok.result.status, 'designed');
    const drop = await handlers.get('omni:run-design-wizard')(trustedEvent, { wizardType: 'drop_test', inputs: {} });
    assert.strictEqual(drop.success, false);
    assert.strictEqual(drop.status, 'INVALID_INPUT');
  });

  check('System IPC: ASME stress screen and self-heal claims', async () => {
    registerIpc(IPC_DEPS);
    const scl = [
      { x: -10, stressMpa: 120 },
      { x: 0, stressMpa: 130 },
      { x: 10, stressMpa: 150 }
    ];
    const ok = await handlers.get('omni:evaluate-asme-viii-div2')(trustedEvent, {
      sclPoints: scl,
      wallThicknessMm: 20,
      allowableStressS: 138,
      allowableStressSource: 'Caller-supplied screening limit',
      isSecondaryThermal: false
    });
    assert.strictEqual(ok.success, true);
    const noSource = await handlers.get('omni:evaluate-asme-viii-div2')(trustedEvent, {
      sclPoints: scl,
      wallThicknessMm: 20,
      allowableStressS: 138,
      allowableStressSource: '  ',
      isSecondaryThermal: false
    });
    assert.strictEqual(noSource.success, false);
    const heal = await handlers.get('omni:self-heal-design')(trustedEvent, {
      currentDesign: {
        wallThicknessMm: 5,
        loadN: 100,
        lengthMm: 10,
        widthMm: 10,
        yieldStrengthMPa: 250,
        youngsModulusGPa: 200,
        minThicknessMm: 1,
        maxThicknessMm: 20
      },
      safetyFactor: 2
    });
    assert.strictEqual(heal.success, false);
    assert.strictEqual(heal.status, 'unavailable');
  });

  check('System IPC: project lifecycle operations', async () => {
    registerIpc(IPC_DEPS);
    const created = await handlers.get('omni:new-project')(trustedEvent, {
      projectName: 'gap31-project',
      author: 'tester'
    });
    assert.strictEqual(created.success, true);
    assert.strictEqual(created.project.projectName, 'gap31-project');
    const summary = await handlers.get('omni:get-project-summary')(trustedEvent);
    assert.strictEqual(summary.success, true);
    assert.strictEqual(summary.project.revision, 1);
    const record = await handlers.get('omni:record-project-command')(trustedEvent, {
      actionType: 'edit_parameter',
      forwardPatch: { value: 2 },
      reversePatch: { value: 1 },
      description: 'set diameter'
    });
    assert.strictEqual(record.success, true);
    assert.strictEqual(record.entry.actionType, 'edit_parameter');
    const undo = await handlers.get('omni:undo')(trustedEvent);
    assert.strictEqual(undo.success, true);
    assert.strictEqual(undo.canRedo, true);
    const redo = await handlers.get('omni:redo')(trustedEvent);
    assert.strictEqual(redo.success, true);
    const history = await handlers.get('omni:get-project-history')(trustedEvent);
    assert.strictEqual(history.success, true);
    assert.strictEqual(history.history.length, 1);
    const noUndo = await handlers.get('omni:undo')(trustedEvent);
    assert.strictEqual(noUndo.success, true);
    const saveMissing = await handlers.get('omni:save-project')(trustedEvent, {});
    assert.strictEqual(saveMissing.success, false);
    const savePath = tmpFile('project.omni');
    const saved = await handlers.get('omni:save-project')(trustedEvent, { filePath: savePath });
    assert.strictEqual(saved.success, true);
    const opened = await handlers.get('omni:open-project')(trustedEvent, { filePath: savePath });
    assert.strictEqual(opened.success, true);
    const openBad = await handlers.get('omni:open-project')(trustedEvent, { filePath: tmpFile('does-not-exist.omni') });
    assert.strictEqual(openBad.success, false);
    const saveIo = await handlers.get('omni:save-project')(trustedEvent, {
      filePath: path.join(TMP, 'no-dir', 'x.omni')
    });
    assert.strictEqual(saveIo.success, true);
  });

  check('System IPC: CAS blob store branches', async () => {
    registerIpc(IPC_DEPS);
    await handlers.get('omni:new-project')(trustedEvent, { projectName: 'blobs' });
    const added = await handlers.get('omni:add-blob')(trustedEvent, {
      content: 'hello blob',
      mimeType: 'text/plain',
      encoding: 'utf8'
    });
    assert.strictEqual(added.success, true);
    assert(added.hash && typeof added.hash === 'object');
    const hashStr = added.hash.hash;
    const fetched = await handlers.get('omni:get-blob')(trustedEvent, { hash: hashStr });
    assert.strictEqual(fetched.success, true);
    assert.strictEqual(fetched.content, 'hello blob');
    const missing = await handlers.get('omni:get-blob')(trustedEvent, { hash: '0'.repeat(64) });
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.error.code, 'NOT_FOUND');
    const noHash = await handlers.get('omni:get-blob')(trustedEvent, { hash: '' });
    assert.strictEqual(noHash.success, false);
    const listed = await handlers.get('omni:list-blobs')(trustedEvent);
    assert.strictEqual(listed.success, true);
    assert.strictEqual(listed.count, 1);
  });

  check('System IPC: mesh domain decomposition and HPC planning/validation routes', async () => {
    registerIpc(IPC_DEPS);
    const part = await handlers.get('omni:mesh-domain-decomposition')(trustedEvent, {
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
        { x: 2, y: 0, z: 0 }
      ],
      numPartitions: 2
    });
    assert.strictEqual(part.success, true);
    assert.strictEqual(part.status, 'PARTITIONED');
    const partBad = await handlers.get('omni:mesh-domain-decomposition')(trustedEvent, {
      points: [[0, 0, 0]],
      numPartitions: 0
    });
    assert.strictEqual(partBad.success, false);
    const ooc = await handlers.get('omni:hpc-plan-out-of-core')(trustedEvent, {
      dofCount: 1000,
      availableRamBytes: 8e9,
      assumptions: { matrixNonzerosPerDof: 20, factorEntriesPerDof: 40 }
    });
    assert.strictEqual(ooc.success, true);
    assert.strictEqual(ooc.status, 'ESTIMATE_ONLY');
    const oocBad = await handlers.get('omni:hpc-plan-out-of-core')(trustedEvent, {
      dofCount: -1,
      availableRamBytes: 1,
      assumptions: { matrixNonzerosPerDof: 1, factorEntriesPerDof: 1 }
    });
    assert.strictEqual(oocBad.success, false);
    const lc = await handlers.get('omni:validate-lifecycle')(trustedEvent, { rootItem: { id: 'it1', state: 'WIP' } });
    assert.strictEqual(lc.success, true);
    const lcBad = await handlers.get('omni:validate-lifecycle')(trustedEvent, {});
    assert.strictEqual(lcBad.success, false);
    const ord = await handlers.get('omni:solve-sparse-ordering')(trustedEvent, { N: 16 });
    assert.strictEqual(ord.success, true);
    assert(ord.orderingMethod && typeof ord.orderingMethod === 'string');
  });

  check('System IPC: stenographer query/evaluate/execute/verify flow', async () => {
    registerIpc(IPC_DEPS);
    await handlers.get('omni:new-project')(trustedEvent, { projectName: 'steno' });
    const summary = await handlers.get('omni:get-project-summary')(trustedEvent);
    const revision = summary.project.revision;
    const tools = await handlers.get('omni:stenographer-get-tools')(trustedEvent);
    assert.strictEqual(tools.success, true);
    assert(tools.count > 0);
    const proposals0 = await handlers.get('omni:stenographer-get-proposals')(trustedEvent);
    assert.strictEqual(proposals0.count, 0);
    const q = await handlers.get('omni:stenographer-query')(trustedEvent, {
      prompt: 'list tools',
      projectRevision: revision
    });
    assert.strictEqual(q.success, true);
    assert.strictEqual(q.queryType, 'list_tools');
    const qLedger = await handlers.get('omni:stenographer-query')(trustedEvent, {
      prompt: 'verify ledger',
      projectRevision: revision
    });
    assert.strictEqual(qLedger.success, true);
    assert.strictEqual(qLedger.integrity.valid, true);
    const qProject = await handlers.get('omni:stenographer-query')(trustedEvent, {
      prompt: 'project status',
      projectRevision: revision
    });
    assert.strictEqual(qProject.success, true);
    assert.strictEqual(qProject.queryType, 'project_status');
    const qDomains = await handlers.get('omni:stenographer-query')(trustedEvent, {
      prompt: 'domain capabilities',
      projectRevision: revision
    });
    assert.strictEqual(qDomains.success, true);
    assert(qDomains.domains.length > 0);
    const qRobotics = await handlers.get('omni:stenographer-query')(trustedEvent, {
      prompt: 'robotics forward kinematics',
      projectRevision: revision
    });
    assert.strictEqual(qRobotics.success, true);
    assert.strictEqual(qRobotics.status, 'PROPOSAL_CREATED');
    const proposalId = qRobotics.proposalId;
    const qStale = await handlers.get('omni:stenographer-query')(trustedEvent, {
      prompt: 'robotics forward kinematics',
      projectRevision: revision + 5
    });
    assert.strictEqual(qStale.success, false);
    const qUnknown = await handlers.get('omni:stenographer-query')(trustedEvent, {
      prompt: 'zzz nothing matches',
      projectRevision: revision
    });
    assert.strictEqual(qUnknown.success, false);
    const staleEval = await handlers.get('omni:stenographer-evaluate-proposal')(trustedEvent, { proposalId: 'nope' });
    assert.strictEqual(staleEval.success, false);
    const evalOk = await handlers.get('omni:stenographer-evaluate-proposal')(trustedEvent, {
      proposalId,
      decision: 'APPROVED',
      rationale: 'ok',
      decidedBy: 'tester'
    });
    assert.strictEqual(evalOk.success, true);
    assert.strictEqual(evalOk.approval.decision, 'APPROVED');
    const execFail = await handlers.get('omni:stenographer-execute-tool')(trustedEvent, { proposalId: 'nope' });
    assert.strictEqual(execFail.success, false);
    const verify = await handlers.get('omni:stenographer-verify-ledger')(trustedEvent);
    assert.strictEqual(verify.success, true);
    assert.strictEqual(verify.daemonConnected, false);
    assert(verify.entries.length > 0);
  });

  // ------------------------------------------------------------------
  // viewport3d.js: constructor, camera branches, load/export, error paths
  // ------------------------------------------------------------------
  check('Viewport3D constructor builds scene, cameras, helpers, and gizmos', () => {
    const vp = new Viewport3D('vp-a');
    assert(vp.scene instanceof global.THREE.Scene);
    assert(vp.camera instanceof global.THREE.PerspectiveCamera);
    assert(vp.topCamera && vp.frontCamera && vp.rightCamera);
    assert(vp.controls && typeof vp.controls.update === 'function');
    assert.strictEqual(vp.viewMode, 'shaded');
    assert(vp.currentMesh !== null, 'default smartphone CAD model should load');
    assert.strictEqual(typeof vp.animate, 'function');
    vp.clearMesh();
  });

  check('Viewport3D constructor throws on missing canvas', () => {
    const realGet = global.document.getElementById;
    global.document.getElementById = (id) => (id === 'vp-missing' ? null : realGet(id));
    assert.throws(() => new Viewport3D('vp-missing'), TypeError);
    global.document.getElementById = realGet;
  });

  check('Viewport3D camera presets and framing branches', () => {
    const vp = new Viewport3D('vp-b');
    for (const preset of ['iso', 'top', 'bottom', 'front', 'back', 'right', 'left', 'reset']) {
      vp.setCameraPreset(preset);
      assert(Number.isFinite(vp.cameraAngle.theta));
      assert(Number.isFinite(vp.cameraAngle.phi));
    }
    vp.setCameraPreset('custom-unknown');
    assert.strictEqual(vp.cameraAngle.theta, 0.65);
    const reset = vp.resetCamera();
    assert.strictEqual(reset.success, true);
    assert(Number.isFinite(reset.distance));
    vp.target.set(10, 20, 30);
    vp.updateCameraPosition();
    assert(vp.camera.position.length() > 0);
  });

  check('Viewport3D mode/explode/wireframe branches', () => {
    const vp = new Viewport3D('vp-c');
    vp.setViewMode('wireframe');
    assert.strictEqual(vp.viewMode, 'wireframe');
    assert.strictEqual(vp.explodeFactor, 0);
    vp.setViewMode('xray');
    assert.strictEqual(vp.viewMode, 'xray');
    vp.setViewMode('exploded');
    assert(vp.explodeFactor > 0);
    vp.setExplodeFactor(5);
    assert.strictEqual(vp.explodeFactor, 1);
    vp.setExplodeFactor(-3);
    assert.strictEqual(vp.explodeFactor, 0);
    const wf = vp.toggleWireframe();
    assert.strictEqual(wf, 'wireframe');
    vp.toggleWireframe();
    assert.strictEqual(vp.viewMode, 'shaded');
    vp.setViewMode('custom');
    assert.strictEqual(vp.viewMode, 'custom');
  });

  check('Viewport3D selection/properties/update/delete branches', () => {
    const vp = new Viewport3D('vp-d');
    const mesh = new global.THREE.Mesh(new global.THREE.BoxGeometry(1, 1, 1), new global.THREE.MeshStandardMaterial());
    mesh.name = 'test-part';
    vp.scene.add(mesh);
    vp.selectPart(mesh);
    assert.strictEqual(vp.selectedPart, mesh);
    const props = vp.getPartProperties(mesh);
    assert.strictEqual(typeof props.name, 'string');
    vp.updateSelectedPart({ material: 'steel' });
    assert.strictEqual(mesh.userData.materialName, 'steel');
    vp.updateSelectedPart({
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 2, z: 2 }
    });
    assert.strictEqual(mesh.position.x, 1);
    assert.strictEqual(mesh.scale.x, 2);
    vp.updateTransform({ position: [5, 5, 5], scale: [0.01, 0.01, 0.01] });
    assert.strictEqual(mesh.position.x, 5);
    assert.strictEqual(mesh.scale.x, 0.01);
    vp.updateTransform({ position: [0, 0, 0] });
    vp.updateTransform(null);
    vp.deselectPart();
    assert.strictEqual(vp.selectedPart, null);
    vp.selectPart(mesh);
    vp.deleteSelectedPart();
    assert.strictEqual(vp.selectedPart, null);
  });

  check('Viewport3D load/export and B-Rep render branches', () => {
    const vp = new Viewport3D('vp-e');
    vp.clearMesh();
    assert.strictEqual(vp.currentMesh, null);
    const triangles = [
      {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0]
        ]
      },
      {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 0, 1]
        ]
      }
    ];
    vp.renderBRepSolid(triangles, 'TriPart');
    assert(vp.currentMesh);
    vp.renderFEAStressHeatmap('normal', 145, [0.2, 0.8], vp.currentMesh);
    assert(vp.currentMesh);
    vp.loadTransientDropData(null);
    vp.renderTransientFrame(0);
    vp.resetTransient();
    assert.strictEqual(vp.isTransientPlaying, false);
  });

  check('Viewport3D transient playback and pause branches', async () => {
    const vp = new Viewport3D('vp-f');
    vp.loadTransientDropData({
      totalDurationMs: 200,
      stepCount: 4,
      frames: [
        { timeMs: 0, positions: [[0, 0, 0]] },
        { timeMs: 50, positions: [[0, -0.1, 0]] },
        { timeMs: 100, positions: [[0, -0.2, 0]] },
        { timeMs: 150, positions: [[0, -0.3, 0]] },
        { timeMs: 200, positions: [[0, -0.4, 0]] }
      ]
    });
    await vp.playTransient();
    assert.strictEqual(vp.isTransientPlaying, true);
    vp.pauseTransient();
    assert.strictEqual(vp.isTransientPlaying, false);
  });

  check('Viewport3D quad view and resize/stats branches', () => {
    const vp = new Viewport3D('vp-g');
    vp.setQuadView(true);
    assert.strictEqual(vp.isQuadView, true);
    vp.toggleQuadView();
    assert.strictEqual(vp.isQuadView, false);
    vp.onResize();
    assert.strictEqual(vp.renderer.domElement, vp.canvas);
    vp.setViewportStats('all systems go');
    assert.strictEqual(vp.viewMode, 'shaded');
  });

  // ------------------------------------------------------------------
  // step_translator.js: entity parsing, unsupported types, round-trip
  // ------------------------------------------------------------------
  check('StepTranslator single-part export with faces and default box fallback', () => {
    const solid = {
      name: 'box',
      faces: [
        {
          name: 'F1',
          normal: { x: 0, y: 0, z: 1 },
          vertices: [
            { point: { x: 0, y: 0, z: 1 } },
            { point: { x: 1, y: 0, z: 1 } },
            { point: { x: 1, y: 1, z: 1 } },
            { point: { x: 0, y: 1, z: 1 } }
          ]
        },
        {
          name: 'F2',
          normal: { x: 0, y: 0, z: -1 },
          vertices: [
            { point: { x: 0, y: 0, z: 0 } },
            { point: { x: 1, y: 0, z: 0 } },
            { point: { x: 1, y: 1, z: 0 } },
            { point: { x: 0, y: 1, z: 0 } }
          ]
        }
      ]
    };
    const step = StepTranslator.exportSTEP(solid, 'BoxPart', { layers: ['L1'] });
    assert(step.includes('ISO-10303-21'));
    assert(step.includes('MANIFOLD_SOLID_BREP'));
    assert(step.includes('ADVANCED_FACE'));
    assert(step.includes('LAYER_ASSIGNMENT'));
    const fallback = StepTranslator.exportSTEP(null, 'EmptyPart');
    assert(fallback.includes('MANIFOLD_SOLID_BREP'));
    assert(fallback.includes('Box_Face_1'));
    assert.strictEqual(StepTranslator.toSTEP(solid, 'Alias'), StepTranslator.exportSTEP(solid, 'Alias'));
    assert(StepTranslator.toSTEP(solid, 'Alias').includes('Alias'));
  });

  check('StepTranslator assembly export and occurrence branches', () => {
    const data = {
      solids: [
        { id: 's1', name: 'Part1', solid: { faces: [] } },
        {
          id: 's2',
          name: 'Part2',
          solid: {
            faces: [
              {
                name: 'P2F1',
                normal: { x: 0, y: 0, z: 1 },
                vertices: [
                  { point: { x: 0, y: 0, z: 1 } },
                  { point: { x: 1, y: 0, z: 1 } },
                  { point: { x: 1, y: 1, z: 1 } },
                  { point: { x: 0, y: 1, z: 1 } }
                ]
              }
            ]
          }
        }
      ],
      assembly: {
        nodes: [
          { id: 'n1', name: 'Part1', solidId: 's1' },
          {
            id: 'n2',
            name: 'Part2',
            solidId: 's2',
            transforms: { origin: [10, 0, 0], axis1: [1, 0, 0], axis2: [0, 1, 0], scale: 1 }
          }
        ],
        references: [
          {
            id: 'r1',
            parentId: null,
            childId: 'n2',
            name: 'Occ2',
            transform: { origin: [10, 0, 0], axis1: [1, 0, 0], axis2: [0, 1, 0], scale: 1 }
          }
        ]
      }
    };
    const step = StepTranslator.exportAssemblySTEP(data, 'Assy');
    assert(step.includes('NEXT_ASSEMBLY_USAGE_OCCURRENCE'));
    assert(step.includes('ITEM_DEFINED_TRANSFORMATION'));
    const childOnly = StepTranslator.exportAssemblySTEP({
      solids: [{ id: 's1', name: 'A', solid: { faces: [] } }],
      assembly: { nodes: [{ id: 'n1', name: 'A', solidId: 's1' }], references: [] }
    });
    assert(childOnly.includes('MANIFOLD_SOLID_BREP'));
  });

  check('StepTranslator NURBS surface export with planar and cylindrical faces', () => {
    const planarFace = {
      name: 'quad',
      vertices: [
        { point: { x: 0, y: 0, z: 0 } },
        { point: { x: 2, y: 0, z: 0 } },
        { point: { x: 2, y: 2, z: 0 } },
        { point: { x: 0, y: 2, z: 0 } }
      ]
    };
    const solid = { faces: [planarFace] };
    const out = StepTranslator.exportNurbsSurfaces(solid, 'PlanarModel');
    assert(out.includes('B_SPLINE_SURFACE_WITH_KNOTS'));
    assert(out.includes('ENDSEC;'));

    const radialFaces = [];
    const N = 8;
    for (let i = 0; i < N; i++) {
      const a0 = (i * 2 * Math.PI) / N;
      const a1 = ((i + 1) * 2 * Math.PI) / N;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      radialFaces.push({
        name: `side${i}`,
        normal: { x: Math.cos((a0 + a1) / 2), y: Math.sin((a0 + a1) / 2), z: 0 },
        vertices: [
          { point: { x: c0, y: s0, z: 0 } },
          { point: { x: c1, y: s1, z: 0 } },
          { point: { x: c1, y: s1, z: 2 } },
          { point: { x: c0, y: s0, z: 2 } }
        ]
      });
    }
    const cylOut = StepTranslator.exportNurbsSurfaces({ faces: radialFaces }, 'CylModel');
    assert(cylOut.includes('RATIONAL_B_SPLINE_SURFACE') || cylOut.includes('B_SPLINE_SURFACE_WITH_KNOTS'));
    const nullOut = StepTranslator.exportNurbsSurfaces(null, 'Empty');
    assert(nullOut.includes('ENDSEC;'));
    const emptyOut = StepTranslator.exportNurbsSurfaces([{ faces: [] }], 'Empty2');
    assert(emptyOut.includes('ENDSEC;'));
  });

  check('StepTranslator trimmed surface export branches', () => {
    const surface = {
      degreeU: 2,
      degreeV: 2,
      controlPoints: [
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 }
        ],
        [
          { x: 0, y: 1, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 2, y: 1, z: 0 }
        ],
        [
          { x: 0, y: 2, z: 0 },
          { x: 1, y: 2, z: 0 },
          { x: 2, y: 2, z: 0 }
        ]
      ],
      weights: [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1]
      ],
      knotsU: [0, 0, 0, 1, 1, 1],
      knotsV: [0, 0, 0, 1, 1, 1]
    };
    const { NurbsSurface } = require('../src/core/cad/nurbs_engine');
    const surf = new NurbsSurface({
      degreeU: 2,
      degreeV: 2,
      controlPoints: [
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 }
        ],
        [
          { x: 0, y: 1, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 2, y: 1, z: 0 }
        ],
        [
          { x: 0, y: 2, z: 0 },
          { x: 1, y: 2, z: 0 },
          { x: 2, y: 2, z: 0 }
        ]
      ],
      knotsU: [0, 0, 0, 1, 1, 1],
      knotsV: [0, 0, 0, 1, 1, 1]
    });
    const curve = new NurbsCurve2D({
      degree: 2,
      controlPoints: [
        [0, 0],
        [1, 0],
        [1, 1]
      ],
      knots: [0, 0, 0, 1, 1, 1]
    });
    const loop = new TrimLoop2D({ curves: [curve] });
    const outerLoop = new TrimLoop2D({ isOuter: true, curves: [curve] });
    const trimmed = new TrimmedNurbsSurface({ surface: surf, trims: [outerLoop, loop] });
    const out = StepTranslator.exportTrimmedSurfaces(trimmed, 'TrimModel');
    assert(out.includes('B_SPLINE_SURFACE_WITH_KNOTS'));
    assert(out.includes('PCURVE'));
    assert(out.includes('SURFACE_CURVE'));
    assert(out.includes('FACE_OUTER_BOUND'));
    assert(out.includes('FACE_BOUND'));
    const rationalSurface = new NurbsSurface({
      degreeU: 2,
      degreeV: 2,
      controlPoints: [
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 }
        ],
        [
          { x: 0, y: 1, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 2, y: 1, z: 0 }
        ],
        [
          { x: 0, y: 2, z: 0 },
          { x: 1, y: 2, z: 0 },
          { x: 2, y: 2, z: 0 }
        ]
      ],
      weights: [
        [1, 1, 1],
        [1, 0.5, 1],
        [1, 1, 1]
      ],
      knotsU: [0, 0, 0, 1, 1, 1],
      knotsV: [0, 0, 0, 1, 1, 1]
    });
    const outRational = StepTranslator.exportTrimmedSurfaces({ surface: rationalSurface, trims: [] }, 'RationalModel');
    assert(outRational.includes('RATIONAL_B_SPLINE_SURFACE'));
    const empty = StepTranslator.exportTrimmedSurfaces([], 'EmptyTrim');
    assert(empty.includes('ENDSEC;'));
    const skipNull = StepTranslator.exportTrimmedSurfaces([null, { surface: null }], 'SkipNull');
    assert(skipNull.includes('ENDSEC;'));
  });

  check('StepTranslator parseSTEP entity counting and assembly records', () => {
    const step = [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION(('desc'),'2;1');",
      "FILE_NAME('box.step','2026-01-01',('a'),('b'),'','','');",
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
      'ENDSEC;',
      'DATA;',
      "#1=CARTESIAN_POINT('',(0.,0.,0.));",
      "#2=CARTESIAN_POINT('',(1.,0.,0.));",
      "#3=DIRECTION('',(0.,0.,1.));",
      "#4=AXIS2_PLACEMENT_3D('',#1,#3,$);",
      "#5=PLANE('',#4);",
      "#6=ADVANCED_FACE('F',(#7),#5,.T.);",
      "#7=FACE_OUTER_BOUND('',#8,.T.);",
      "#8=EDGE_LOOP('',(#9));",
      "#9=ORIENTED_EDGE('',*,*,#10,.T.);",
      "#10=EDGE_CURVE('',#11,#12,#13,.T.);",
      "#11=VERTEX_POINT('',#1);",
      "#12=VERTEX_POINT('',#2);",
      "#13=LINE('',#1,#3);",
      "#14=MANIFOLD_SOLID_BREP('B',#6);",
      "#15=PRODUCT('P','P','',(#16));",
      "#16=PRODUCT_CONTEXT('',#18,'mechanical');",
      "#17=PRODUCT_DEFINITION('','',#15,#20);",
      "#18=PRODUCT_DEFINITION_SHAPE('','',#17);",
      '#19=SHAPE_DEFINITION_REPRESENTATION(#18,#21);',
      "#20=PRODUCT_DEFINITION_CONTEXT('part',#18,'design');",
      "#21=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#14),#4);",
      "#22=NEXT_ASSEMBLY_USAGE_OCCURRENCE(#17,#15,'R1','Occ','');",
      "#23=ITEM_DEFINED_TRANSFORMATION('','',#4,#14);",
      "#24=CARTESIAN_TRANSFORMATION_3D('',#1,#3,#3,1.);",
      "#25=DRAUGHTING_MODEL('',(#14));",
      "#26=LAYER_ASSIGNMENT('L1',(#14));",
      "#27=COLOUR_RGB('',0.1,0.2,0.3);",
      "#28=B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#1,#2),(#1,#2)),.PLANAR.,.F.,.F.,.F.,(0.,0.,1.,1.),(0.,0.,1.,1.),.QUASI_UNIFORM_KNOTS.);",
      "#29=RATIONAL_B_SPLINE_SURFACE('',1,1,((#1,#2),(#1,#2)),.PLANAR.,.F.,.F.,.F.,(0.,0.,1.,1.),(0.,0.,1.,1.),.UNSPECIFIED.,((1.,1.),(1.,1.)));",
      "#30=B_SPLINE_CURVE_WITH_KNOTS('',1,(#1,#2),.UNSPECIFIED.,.F.,.F.,(0.,0.,1.,1.),.UNSPECIFIED.);",
      "#31=RATIONAL_B_SPLINE_CURVE_WITH_KNOTS('',1,(#1,#2),.UNSPECIFIED.,.F.,.F.,(0.,0.,1.,1.),.UNSPECIFIED.,(1.,1.));",
      "#32=PCURVE('',#5,#30);",
      "#33=SURFACE_CURVE('',#30,(#32),.BOUNDARY.);",
      "#34=FACE_BOUND('',#8,.T.);",
      'ENDSEC;',
      'END-ISO-10303-21;'
    ].join('\n');
    const parsed = StepTranslator.parseSTEP(step);
    assert.strictEqual(parsed.header.fileName, 'box.step');
    assert.strictEqual(parsed.summary.cartesianPointsCount, 2);
    assert.strictEqual(parsed.summary.advancedFacesCount, 1);
    assert.strictEqual(parsed.summary.manifoldSolidsCount, 1);
    assert.strictEqual(parsed.summary.productsCount, 1);
    assert.strictEqual(parsed.summary.shapeDefinitionRepresentationsCount, 1);
    assert.strictEqual(parsed.summary.nextAssemblyUsageOccurrencesCount, 1);
    assert.strictEqual(parsed.summary.itemDefinedTransformationsCount, 1);
    assert.strictEqual(parsed.summary.cartesianTransformationsCount, 1);
    assert.strictEqual(parsed.summary.draughtingModelsCount, 1);
    assert.strictEqual(parsed.summary.layerAssignmentsCount, 1);
    assert.strictEqual(parsed.summary.colourRgbCount, 1);
    assert.strictEqual(parsed.summary.bSplineSurfacesCount, 2);
    assert.strictEqual(parsed.summary.rationalBSplineSurfacesCount, 1);
    assert.strictEqual(parsed.summary.bSplineCurvesCount, 2);
    assert.strictEqual(parsed.summary.rationalBSplineCurvesCount, 1);
    assert.strictEqual(parsed.summary.pCurvesCount, 1);
    assert.strictEqual(parsed.summary.surfaceCurvesCount, 1);
    assert.strictEqual(parsed.summary.faceBoundsCount, 1);
    assert.strictEqual(parsed.summary.faceOuterBoundsCount, 1);
    assert.strictEqual(parsed.summary.edgeLoopsCount, 1);
    assert.strictEqual(parsed.nurbsSurfaces.length, 2);
    assert.strictEqual(parsed.trimCurves.length, 2);
    assert.strictEqual(parsed.pCurves.length, 1);
    assert(parsed.assembly.nodes.some((n) => n.type === 'PRODUCT'));
    assert(parsed.assembly.occurrences.some((o) => o.referenceDesignator === 'R1'));
    assert.strictEqual(parsed.totalEntities, 34);
  });

  check('StepTranslator parseSTEP error and boundary branches', () => {
    assert.throws(() => StepTranslator.parseSTEP(null), /non-empty string/);
    assert.throws(() => StepTranslator.parseSTEP(42), /non-empty string/);
    const noData = StepTranslator.parseSTEP('ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;');
    assert.strictEqual(noData.totalEntities, undefined);
    assert.deepStrictEqual(noData.entities, {});
    assert.strictEqual(noData.header.schema, '');
    const small = StepTranslator.parseSTEP(
      "ISO-10303-21;\nDATA;\n#1=CARTESIAN_POINT('',(1.,2.,3.));\nENDSEC;\nEND-ISO-10303-21;"
    );
    assert.deepStrictEqual(small.entities['#1'].coordinates, [1, 2, 3]);
    const badNurbs = StepTranslator.parseSTEP(
      "ISO-10303-21;\nDATA;\n#1=RATIONAL_B_SPLINE_SURFACE('',1,1,((#2)),.PLANAR.,.F.,.F.,.F.,(0.,1.),(0.,1.),.UNSPECIFIED.,((1.)));\n#2=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;"
    );
    assert.strictEqual(badNurbs.nurbsSurfaces.length, 1);
  });

  // ------------------------------------------------------------------
  // robotics_engine_adapter.js: six-operation execute matrix
  // ------------------------------------------------------------------
  check('Robotics adapter forward_kinematics success and fail paths', async () => {
    const adapter = new RoboticsEngineAdapter();
    const fk = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: { preset: 'PUMA_560', q: [0, 0, 0, 0, 0, 0] }
      })
    );
    assert.strictEqual(fk.status, 'COMPLETED');
    assert(fk.outputData.position && typeof fk.outputData.position.x.valueSi === 'number');
    assert(fk.outputData.endEffectorPose);
    const fkTarget = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: {
          dhTable: PRESET_REGISTRY.PUMA_560,
          q: [0, 0, 0, 0, 0, 0],
          targetPosition: [0.5, 0, 0.5],
          targetOrientation: [0, 0, 0]
        }
      })
    );
    assert.strictEqual(fkTarget.status, 'COMPLETED');
    const fkVel = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: { dhTable: PRESET_REGISTRY.PUMA_560, q: [0, 0, 0, 0, 0, 0], qd: [0, 0, 0, 0, 0, 0] }
      })
    );
    assert(fkVel.outputData.endEffectorLinearSpeed);
    assert.strictEqual(fkVel.outputData.endEffectorLinearSpeed.valueSi, 0);
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { dhTable: PRESET_REGISTRY.PUMA_560, q: [0, 0] }
        })
      ),
      /q/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({ domain: 'robotics', operation: 'forward_kinematics', parameters: { dhTable: [] } })
      ),
      /non-empty dhTable/
    );
  });

  check('Robotics adapter inverse_kinematics success and fail paths', async () => {
    const adapter = new RoboticsEngineAdapter();
    const planar = [
      { a: 1, alpha: 0, d: 0 },
      { a: 1, alpha: 0, d: 0 }
    ];
    const ik = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'inverse_kinematics',
        parameters: { dhTable: planar, targetPose: { position: [1.5, 0, 0] }, q0: [0.5, 0.5], maxIterations: 100 }
      })
    );
    assert.strictEqual(ik.status, 'COMPLETED');
    assert(ik.outputData.qValues && ik.outputData.qValues.length === 2);
    assert(ik.outputData.jointAngles && ik.outputData.jointAngles.length === 2);
    assert.strictEqual(ik.outputData.converged, true);
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { dhTable: planar, targetPose: [0, 0] }
        })
      ),
      /targetPose/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { dhTable: planar, targetPose: { position: [0, 0, 0] }, q0: [0] }
        })
      ),
      /q0/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: {
            poeConfig: {
              screwAxes: [[0, 0, 1, 0, 0, 0]],
              homeTransform: [
                [1, 0, 0, 0],
                [0, 1, 0, 0],
                [0, 0, 1, 0],
                [0, 0, 0, 1]
              ]
            },
            targetPose: { position: [0, 0, 0] }
          }
        })
      ),
      /dhTable/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'inverse_kinematics',
          parameters: { dhTable: planar, targetPose: { position: [3, 0, 0] }, q0: [0.5, 0.5], maxIterations: 3 }
        })
      ),
      /converge|failed/i
    );
  });

  check('Robotics adapter inverse_dynamics success and fail paths', async () => {
    const adapter = new RoboticsEngineAdapter();
    const dyn = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'inverse_dynamics',
        parameters: {
          preset: 'KUKA_IIWA',
          q: [0, 0, 0, 0, 0, 0, 0],
          qd: [0, 0, 0, 0, 0, 0, 0],
          qdd: [0, 0, 0, 0, 0, 0, 0],
          linkDynamics: Array.from({ length: 7 }, () => ({ mass: 1.0 })),
          gravity: [0, 0, -9.81],
          fTip: [0, 0, 0, 0, 0, 0]
        }
      })
    );
    assert.strictEqual(dyn.status, 'COMPLETED');
    assert(dyn.outputData.torques || dyn.outputData.jointTorques);
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'inverse_dynamics',
          parameters: {
            preset: 'KUKA_IIWA',
            q: [0, 0, 0, 0, 0, 0, 0],
            qd: [0, 0, 0, 0, 0, 0, 0],
            qdd: [0, 0, 0, 0, 0, 0, 0],
            linkDynamics: [{ mass: 1 }],
            gravity: [0, 0, -9.81],
            fTip: [0, 0, 0, 0, 0, 0]
          }
        })
      ),
      /linkDynamics/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'inverse_dynamics',
          parameters: {
            preset: 'KUKA_IIWA',
            q: [0, 0, 0, 0, 0, 0, 0],
            qd: [0, 0, 0, 0, 0, 0, 0],
            qdd: [0, 0, 0, 0, 0, 0, 0],
            linkDynamics: Array.from({ length: 7 }, () => ({ mass: -1 })),
            gravity: [0, 0, -9.81],
            fTip: [0, 0, 0, 0, 0, 0]
          }
        })
      ),
      /mass/
    );
  });

  check('Robotics adapter trajectory_plan success and fail paths', async () => {
    const adapter = new RoboticsEngineAdapter();
    const traj = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'trajectory_plan',
        parameters: { q0: [0, 0, 0], qf: [1, 1, 1], duration: 2, numSteps: 10 }
      })
    );
    assert.strictEqual(traj.status, 'COMPLETED');
    assert(traj.outputData.samples && traj.outputData.samples.length >= 2);
    assert(traj.outputData.waypoints && traj.outputData.waypoints.length >= 2);
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'trajectory_plan',
          parameters: { q0: [0, 0, 0], qf: [1, 1, 1], duration: 0 }
        })
      ),
      /positive duration/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'trajectory_plan',
          parameters: { q0: [0, 0, 0], qf: [1, 1], duration: 2 }
        })
      ),
      /qf/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'trajectory_plan',
          parameters: { q0: [0, 0, 0], qf: [1, 1, 1], duration: 2, numSteps: 1 }
        })
      ),
      /numSteps/
    );
  });

  check('Robotics adapter URDF parse success and fail paths', async () => {
    const adapter = new RoboticsEngineAdapter();
    const urdf = `<?xml version="1.0"?>
    <robot name="mini">
      <link name="base"/>
      <link name="tip"/>
      <joint name="j1" type="revolute">
        <parent link="base"/>
        <child link="tip"/>
        <origin xyz="0 0 0.2" rpy="0 0 0"/>
        <axis xyz="0 0 1"/>
        <limit lower="-3.14" upper="3.14" effort="10" velocity="1"/>
      </joint>
    </robot>`;
    const parsed = await adapter.execute(
      new JobRequest({ domain: 'robotics', operation: 'parse_urdf', parameters: { urdf } })
    );
    assert.strictEqual(parsed.status, 'COMPLETED');
    assert.strictEqual(parsed.outputData.name, 'mini');
    assert(parsed.outputData.joints && parsed.outputData.joints.length === 1);
    await assert.rejects(
      adapter.execute(
        new JobRequest({ domain: 'robotics', operation: 'parse_urdf', parameters: { urdf: '<not-xml' } })
      ),
      /urdf|URDF|XML/i
    );
    await assert.rejects(
      adapter.execute(new JobRequest({ domain: 'robotics', operation: 'parse_urdf', parameters: {} })),
      /urdf|URDF|XML/i
    );
    const jsonModel = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'parse_urdf',
        parameters: {
          json: {
            name: 'j2',
            links: [{ name: 'base' }, { name: 'tip' }],
            joints: [
              {
                name: 'j1',
                type: 'revolute',
                parent: 'base',
                child: 'tip',
                origin: { xyz: [0, 0, 0.2], rpy: [0, 0, 0] },
                axis: [0, 0, 1],
                limit: { lower: -3.14, upper: 3.14, effort: 10, velocity: 1 }
              }
            ]
          }
        }
      })
    );
    assert.strictEqual(jsonModel.status, 'COMPLETED');
    assert.strictEqual(jsonModel.outputData.name, 'j2');
  });

  check('Robotics adapter collision_check success and fail paths', async () => {
    const adapter = new RoboticsEngineAdapter();
    const farTri = { a: [5, 5, 5], b: [6, 5, 5], c: [5, 6, 5] };
    const originTri = { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] };
    const coll = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'collision_check',
        parameters: {
          preset: 'PUMA_560',
          qStart: [0, 0, 0, 0, 0, 0],
          qEnd: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
          obstacles: [{ triangles: [farTri] }],
          numSamples: 4
        }
      })
    );
    assert.strictEqual(coll.status, 'COMPLETED');
    assert.strictEqual(coll.outputData.collision, null);
    const collHit = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'collision_check',
        parameters: {
          preset: 'PUMA_560',
          qStart: [0, 0, 0, 0, 0, 0],
          qEnd: [0, 0, 0, 0, 0, 0],
          obstacles: [{ mesh: { triangles: [originTri] } }],
          numSamples: 4
        }
      })
    );
    assert.strictEqual(collHit.status, 'COMPLETED');
    assert.strictEqual(collHit.outputData.collision.collided, true);
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'collision_check',
          parameters: { preset: 'PUMA_560', qStart: [0, 0, 0, 0, 0, 0], qEnd: [0, 0, 0, 0, 0, 0], obstacles: [] }
        })
      ),
      /obstacles|non-empty/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'collision_check',
          parameters: {
            preset: 'PUMA_560',
            qStart: [0, 0, 0, 0, 0, 0],
            qEnd: [0, 0, 0, 0, 0, 0],
            obstacles: [{ triangles: [originTri] }],
            step: 0
          }
        })
      ),
      /step/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'collision_check',
          parameters: {
            preset: 'PUMA_560',
            qStart: [0],
            qEnd: [0, 0, 0, 0, 0, 0],
            obstacles: [{ triangles: [originTri] }]
          }
        })
      ),
      /qStart/
    );
    await assert.rejects(
      adapter.execute(
        new JobRequest({
          domain: 'robotics',
          operation: 'collision_check',
          parameters: {
            preset: 'PUMA_560',
            qStart: [0, 0, 0, 0, 0, 0],
            qEnd: [0, 0, 0, 0, 0, 0],
            obstacles: [{ triangles: [originTri] }],
            linkRadius: -1
          }
        })
      ),
      /linkRadius/
    );
  });

  check('Robotics adapter validate and extractRequest guard branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    await assert.rejects(adapter.execute(null), /null|non-object/);
    await assert.rejects(adapter.execute({ domain: 'cad', operation: 'forward_kinematics' }), /Domain mismatch/);
    await assert.rejects(adapter.execute({ domain: 'robotics' }), /operation/);
    await assert.rejects(adapter.execute({ domain: 'robotics', operation: 'fly' }), /Unsupported robotics operation/);
    const input = await adapter.execute(
      new JobRequest({
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: { preset: 'UR5E', q: [0, 0, 0, 0, 0, 0] }
      })
    );
    assert.strictEqual(input.status, 'COMPLETED');
    assert.strictEqual(SUPPORTED_OPERATIONS.length, 6);
    assert.strictEqual(typeof PRESET_REGISTRY.PUMA_560, 'object');
  });

  // ------------------------------------------------------------------
  // omni_archive.js: v3 trailer/stream errors, WAL failure paths, vault
  // ------------------------------------------------------------------
  check('OmniArchiveV3 writeChunks/readIndex/readEntry round trip', async () => {
    const archivePath = tmpFile('v3.omni');
    const chunks = [];
    const writable = new (require('stream').Writable)({
      write(chunk, enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      }
    });
    const entries = [
      { name: 'manifest.json', stream: Buffer.from(JSON.stringify({ schemaVersion: '2.0.0' })) },
      { name: 'blobs/abc', stream: [Buffer.from('hello '), Buffer.from('world'), Buffer.from('!')] }
    ];
    const summary = await OmniArchiveV3.writeChunks(writable, entries, { chunkSize: 8, compression: true });
    assert.strictEqual(summary.entries.length, 2);
    assert(summary.entries[0].chunkCount > 0);
    const fileBuf = Buffer.concat(chunks);
    fs.writeFileSync(archivePath, fileBuf);
    const idx = OmniArchiveV3.readIndex(archivePath);
    assert.strictEqual(idx.entries.length, 2);
    const manifest = OmniArchiveV3.readEntryBufferSync(archivePath, 'manifest.json');
    assert.strictEqual(JSON.parse(manifest.toString('utf8')).schemaVersion, '2.0.0');
    const blob = OmniArchiveV3.readEntryBufferSync(archivePath, 'blobs/abc');
    assert.strictEqual(blob.toString('utf8'), 'hello world!');
  });

  check('OmniArchiveV3 writeChunks validation branches', async () => {
    const collect = () => {
      const chunks = [];
      return {
        writable: new (require('stream').Writable)({
          write(chunk, enc, cb) {
            chunks.push(Buffer.from(chunk));
            cb();
          }
        }),
        chunks
      };
    };
    await assert.rejects(() => OmniArchiveV3.writeChunks(null, []), /writable stream/);
    const { writable, chunks } = collect();
    await assert.rejects(
      () => OmniArchiveV3.writeChunks(writable, [{ name: '', stream: [] }]),
      /name must not be empty/
    );
    await assert.rejects(
      () =>
        OmniArchiveV3.writeChunks(writable, [
          { name: 'a', stream: [] },
          { name: 'a', stream: [] }
        ]),
      /Duplicate/
    );
    chunks.length = 0;
    const noCompression = await OmniArchiveV3.writeChunks(writable, [{ name: 'plain', stream: Buffer.from('data') }], {
      compression: false,
      chunkSize: 4
    });
    assert.strictEqual(noCompression.entries[0].chunkCount, 1);
  });

  check('OmniArchiveV3 readIndex malformed-archive error branches', async () => {
    const p = tmpFile('bad-v3.omni');
    fs.writeFileSync(p, Buffer.alloc(10));
    assert.throws(() => OmniArchiveV3.readIndex(p), /file too small/);
    fs.writeFileSync(p, Buffer.concat([Buffer.from('NOPE'), Buffer.alloc(40)]));
    assert.throws(() => OmniArchiveV3.readIndex(p), /missing OMNIENG/);
    const good = Buffer.alloc(28);
    MAGIC_BYTES_V3.copy(good, 0);
    good.writeUInt32BE(1, 8);
    good.writeUInt32BE(1, 12);
    good.writeUInt32BE(1024, 16);
    fs.writeFileSync(p, Buffer.concat([good, Buffer.alloc(16)]));
    assert.throws(() => OmniArchiveV3.readIndex(p), /missing trailer magic/);
    const validPath = tmpFile('valid-v3.omni');
    const chunks = [];
    const writable = new (require('stream').Writable)({
      write(chunk, enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      }
    });
    await OmniArchiveV3.writeChunks(writable, [{ name: 'a', stream: Buffer.from('x') }]);
    const validBuf = Buffer.concat(chunks);
    fs.writeFileSync(validPath, validBuf);
    const badOffset = Buffer.from(validBuf);
    badOffset.writeBigUInt64BE(BigInt(4), badOffset.length - 16);
    fs.writeFileSync(p, badOffset);
    assert.throws(() => OmniArchiveV3.readIndex(p), /invalid trailer offset/);
  });

  check('OmniArchiveV3 readIndex corrupted trailer records', async () => {
    const archivePath = tmpFile('v3-trailer.omni');
    const chunks = [];
    const writable = new (require('stream').Writable)({
      write(chunk, enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      }
    });
    await OmniArchiveV3.writeChunks(writable, [{ name: 'a', stream: Buffer.from('x') }]);
    const buf = Buffer.concat(chunks);
    fs.writeFileSync(archivePath, buf);
    const idx = OmniArchiveV3.readIndex(archivePath);
    const trailerOffset = idx.trailerOffset;
    const footerStart = buf.length - 16;
    const truncatedPath = tmpFile('v3-truncated.omni');
    const truncated = Buffer.concat([buf.subarray(0, trailerOffset + 4), buf.subarray(footerStart)]);
    fs.writeFileSync(truncatedPath, truncated);
    assert.throws(() => OmniArchiveV3.readIndex(truncatedPath), /truncated trailer/);
    const badNamePath = tmpFile('v3-badname.omni');
    const badName = Buffer.from(buf);
    badName.writeUInt32BE(0xffff0000, trailerOffset + 4);
    fs.writeFileSync(badNamePath, badName);
    assert.throws(() => OmniArchiveV3.readIndex(badNamePath), /bad entry name/);
    const garbagePath = tmpFile('v3-garbage.omni');
    const garbage = Buffer.concat([buf.subarray(0, footerStart), Buffer.from([0xaa]), buf.subarray(footerStart)]);
    fs.writeFileSync(garbagePath, garbage);
    assert.throws(() => OmniArchiveV3.readIndex(garbagePath), /trailing garbage/);
  });

  check('OmniArchiveV3 readEntryStream failure paths', async () => {
    const archivePath = tmpFile('v3-stream.omni');
    const chunks = [];
    const writable = new (require('stream').Writable)({
      write(chunk, enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      }
    });
    await OmniArchiveV3.writeChunks(writable, [
      { name: 'empty', stream: Buffer.alloc(0) },
      { name: 'data', stream: Buffer.from('payload-bytes') }
    ]);
    const buf = Buffer.concat(chunks);
    fs.writeFileSync(archivePath, buf);
    const missing = OmniArchiveV3.readEntryStream(archivePath, 'nope');
    await assert.rejects(
      new Promise((resolve, reject) => {
        missing.on('data', () => {});
        missing.on('end', resolve);
        missing.on('error', reject);
      }),
      /entry not found/
    );
    const empty = OmniArchiveV3.readEntryStream(archivePath, 'empty');
    const emptyData = [];
    await new Promise((resolve, reject) => {
      empty.on('data', (d) => emptyData.push(d));
      empty.on('end', resolve);
      empty.on('error', reject);
    });
    assert.strictEqual(Buffer.concat(emptyData).length, 0);
    const good = OmniArchiveV3.readEntryStream(archivePath, 'data');
    const goodData = [];
    await new Promise((resolve, reject) => {
      good.on('data', (d) => goodData.push(d));
      good.on('end', resolve);
      good.on('error', reject);
    });
    assert.strictEqual(Buffer.concat(goodData).toString('utf8'), 'payload-bytes');
    const tampered = Buffer.from(buf);
    tampered[60] ^= 0xff;
    fs.writeFileSync(archivePath, tampered);
    const bad = OmniArchiveV3.readEntryStream(archivePath, 'data');
    await assert.rejects(
      new Promise((resolve, reject) => {
        bad.on('data', () => {});
        bad.on('end', resolve);
        bad.on('error', reject);
      }),
      /sha256 mismatch|Integrity failure/
    );
  });

  check('OmniArchiveV3 readEntryBufferSync integrity failures', async () => {
    const archivePath = tmpFile('v3-buf.omni');
    const chunks = [];
    const writable = new (require('stream').Writable)({
      write(chunk, enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      }
    });
    await OmniArchiveV3.writeChunks(writable, [{ name: 'data', stream: Buffer.from('0123456789') }]);
    const buf = Buffer.concat(chunks);
    fs.writeFileSync(archivePath, buf);
    const good = OmniArchiveV3.readEntryBufferSync(archivePath, 'data');
    assert.strictEqual(good.toString('utf8'), '0123456789');
    const idx = OmniArchiveV3.readIndex(archivePath);
    const entry = idx.entries[0];
    const { dataStart, dataEnd } = OmniArchiveV3._entryDataRange(entry);
    const tampered = Buffer.from(buf);
    tampered[dataStart + 2] ^= 0x01;
    fs.writeFileSync(archivePath, tampered);
    assert.throws(() => OmniArchiveV3.readEntryBufferSync(archivePath, 'data'), /Integrity failure/);
    fs.writeFileSync(archivePath, buf);
    assert.throws(() => OmniArchiveV3.readEntryBufferSync(archivePath, 'missing'), /entry not found/);
    const emptyArchive = tmpFile('v3-empty.omni');
    fs.writeFileSync(emptyArchive, Buffer.alloc(0));
    assert.throws(() => OmniArchiveV3.readEntryBufferSync(emptyArchive, 'data'), /file too small/);
    assert.strictEqual(
      OmniArchiveV3._entryDataRange(entry).dataStart,
      entry.entryOffset + 4 + Buffer.byteLength(entry.name)
    );
    assert.strictEqual(OmniArchiveV3._entryDataRange(entry).dataEnd, entry.entryOffset + entry.entryLength);
    assert(dataEnd > dataStart);
  });

  check('OmniArchiveV3 loadArchiveSync manifest and journal branches', async () => {
    const archivePath = tmpFile('v3-load.omni');
    const manifest = {
      schemaVersion: '2.0.0',
      projectId: 'proj-1',
      name: 'archive',
      author: 'tester',
      engineeringDomain: 'universal',
      revision: 1,
      activeUnits: 'SI_MM',
      domainModels: {},
      blobs: {},
      journalRef: '',
      results: [],
      signatures: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    const chunks = [];
    const writable = new (require('stream').Writable)({
      write(chunk, enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      }
    });
    await OmniArchiveV3.writeChunks(writable, [
      { name: 'manifest.json', stream: Buffer.from(JSON.stringify(manifest)) },
      { name: 'journal.json', stream: Buffer.from(JSON.stringify({ history: [], currentIndex: -1 })) },
      { name: 'results.json', stream: Buffer.from(JSON.stringify([])) },
      { name: 'blobs/deadbeef', stream: Buffer.from('blob-data') }
    ]);
    fs.writeFileSync(archivePath, Buffer.concat(chunks));
    const v2 = OmniArchiveV3.loadArchiveSync(archivePath);
    assert.strictEqual(v2.manifest.projectId, 'proj-1');
    assert.strictEqual(v2.blobs.get('deadbeef').toString('utf8'), 'blob-data');
    const badManifest = { schemaVersion: '9.9.9' };
    const chunks2 = [];
    const writable2 = new (require('stream').Writable)({
      write(chunk, enc, cb) {
        chunks2.push(Buffer.from(chunk));
        cb();
      }
    });
    await OmniArchiveV3.writeChunks(writable2, [
      { name: 'manifest.json', stream: Buffer.from(JSON.stringify(badManifest)) }
    ]);
    const badPath = tmpFile('v3-bad-manifest.omni');
    fs.writeFileSync(badPath, Buffer.concat(chunks2));
    assert.throws(() => OmniArchiveV3.loadArchiveSync(badPath), /schemaVersion/);
  });

  check('OmniWal open/append/flush/commit/rebase/stats', () => {
    const archivePath = tmpFile('archive.omni');
    const walPath = tmpFile('archive.omni.wal');
    const wal = new OmniWal({ path: walPath, archivePath });
    wal.open();
    assert.strictEqual(wal.stats().seq, 1);
    const e1 = wal.appendEntry('add_blob', { dataBase64: Buffer.from('x').toString('base64') });
    assert.strictEqual(e1.pending, 1);
    const flushed = wal.flush();
    assert.strictEqual(flushed.pending, 1);
    const committed = wal.commit();
    assert.strictEqual(committed.pending, 0);
    assert.strictEqual(committed.committed, 1);
    wal.appendEntry('journal_execute', { actionType: 'edit', forwardPatch: {}, reversePatch: {} });
    wal.commit();
    const stats = wal.stats();
    assert.strictEqual(stats.committed, 2);
    wal.rebase();
    assert.strictEqual(wal.stats().committed, 0);
    assert.strictEqual(wal.stats().seq, 1);
    wal.close();
    const reopened = new OmniWal({ path: walPath, archivePath });
    reopened.open();
    assert.strictEqual(reopened.stats().seq, 1);
    assert.strictEqual(reopened.stats().committed, 0);
    reopened.close();
  });

  check('OmniWal failure branches: not open, torn tail, mismatched archive', () => {
    const walPath = tmpFile('fail.wal');
    const archivePath = tmpFile('fail.omni');
    const wal = new OmniWal({ path: walPath, archivePath });
    assert.throws(() => wal.appendEntry('x', {}), /not open/);
    wal.open();
    assert.throws(() => wal.appendEntry('', {}), /non-empty string/);
    wal.appendEntry('add_blob', {});
    const fd = wal.fd;
    fs.closeSync(fd);
    wal.fd = null;
    assert.throws(() => wal.flush(), TypeError);
    assert.throws(() => wal.commit(), TypeError);
    wal.open();
    wal.close();
    const header = OmniWal.encodeHeader(archivePath);
    const line1 = OmniWal.encodeLine(1, JSON.stringify({ op: 'add_blob', payload: null }), 'a'.repeat(64));
    fs.writeFileSync(walPath, `${header}\n${line1}\nGARBAGE_NOT_JSON\n`);
    const tornWal = new OmniWal({ path: walPath, archivePath });
    tornWal.open();
    assert.strictEqual(tornWal.stats().recovered, true);
    assert.strictEqual(tornWal.stats().committed, 0);
    tornWal.close();
    const otherWal = new OmniWal({ path: walPath, archivePath: tmpFile('other.omni') });
    assert.throws(() => otherWal.open(), /matching v3 journal/);
  });

  check('OmniWal reopen recovery across corrupt and clean journal states', () => {
    const walPath = tmpFile('parse.wal');
    const archivePath = tmpFile('parse.omni');
    const header = OmniWal.encodeHeader(archivePath);
    fs.writeFileSync(walPath, `not-json\n`);
    const badHeaderWal = new OmniWal({ path: walPath, archivePath });
    assert.throws(() => badHeaderWal.open(), /matching v3 journal/);
    const goodLine = OmniWal.encodeLine(1, JSON.stringify({ op: 'add_blob', payload: null }), 'a'.repeat(64));
    const commitLine = OmniWal.encodeLine(1, 'COMMIT', null);
    fs.writeFileSync(walPath, `${header}\n${goodLine}\n${commitLine}\n`);
    const cleanWal = new OmniWal({ path: walPath, archivePath });
    cleanWal.open();
    assert.strictEqual(cleanWal.stats().recovered, false);
    assert.strictEqual(cleanWal.stats().committed, 1);
    assert.strictEqual(cleanWal.stats().seq, 2);
    cleanWal.close();
    fs.writeFileSync(walPath, `${header}\n${goodLine}\n[1,"COMMIT",null,123]\n`);
    const crcWal = new OmniWal({ path: walPath, archivePath });
    crcWal.open();
    assert.strictEqual(crcWal.stats().recovered, true);
    crcWal.close();
    fs.writeFileSync(
      walPath,
      `${header}\n${goodLine}\n[2,"COMMIT",null,${calculateCRC32(Buffer.from(JSON.stringify([2, 'COMMIT', null]), 'utf8'))}]\n`
    );
    const seqWal = new OmniWal({ path: walPath, archivePath });
    seqWal.open();
    assert.strictEqual(seqWal.stats().recovered, true);
    seqWal.close();
  });

  check('OmniArchive v1 encrypted save/load branches and atomic save', () => {
    const archive = new OmniArchive({ projectName: 'sealed' });
    archive.addSection('data', { value: 42 });
    assert.throws(() => archive.saveToEncryptedBuffer('abc'), /at least 4 characters/);
    const sealed = archive.saveToEncryptedBuffer('hunter2');
    assert(sealed.length > 52);
    const reopened = OmniArchive.loadFromEncryptedBuffer(sealed, 'hunter2');
    assert.strictEqual(reopened.getSection('data', true).value, 42);
    assert.throws(() => OmniArchive.loadFromEncryptedBuffer(sealed, ''), /Password must be provided/);
    assert.throws(() => OmniArchive.loadFromEncryptedBuffer(sealed, 'wrong-password'), /Decryption Failed/);
    const target = tmpFile('atomic.omni');
    saveAtomicSync(target, archive.saveToBuffer());
    assert(fs.existsSync(target));
    const loaded = OmniArchive.loadFromFile(target);
    assert.strictEqual(loaded.getSection('data', true).value, 42);
    saveAtomicSync(target, archive.saveToBuffer(), false);
    assert(fs.existsSync(target));
  });

  check('OmniArchive v1 addSection/load error branches', () => {
    const archive = new OmniArchive();
    assert.throws(() => archive.addSection('  ', 'x'), /non-empty string/);
    assert.throws(
      () => archive.addSection('big', Buffer.alloc(MAX_UNCOMPRESSED_SECTION_SIZE + 1)),
      /maximum uncompressed size/
    );
    assert.throws(() => archive.addSection('bad', 42), /Unsupported content type/);
    assert.throws(() => OmniArchive.loadFromBuffer(Buffer.alloc(8)), /too small|magic/);
    assert.throws(() => OmniArchive.loadFromBuffer(Buffer.concat([Buffer.from('XXXXXXXX'), Buffer.alloc(4)])), /magic/);
    const buf = archive.saveToBuffer();
    assert(buf.slice(0, 8).equals(MAGIC_BYTES_V1));
    assert.strictEqual(archive.listSections().includes('manifest'), true);
    assert.strictEqual(archive.hasSection('manifest'), true);
    assert.strictEqual(archive.hasSection('nope'), false);
  });

  // ------------------------------------------------------------------
  // stenographer_supervisor.js: daemon lifecycle, proposals, signed ledger
  // ------------------------------------------------------------------
  check('StenographerSupervisor constructor options and tool registration', () => {
    const sv = new StenographerSupervisor({ maxRestarts: 2, mockMode: true, hmacSecret: 'x'.repeat(32) });
    assert.strictEqual(sv.maxRestarts, 2);
    assert.strictEqual(sv.mockMode, true);
    assert.strictEqual(sv.ledgerKeyIsPersistent, true);
    assert.strictEqual(sv.getRegisteredTools().length > 0, true);
    assert.strictEqual(sv.getProposal('nope'), null);
    assert.strictEqual(sv.getAuditLedger().length, 0);
    assert.throws(() => new StenographerSupervisor({ hmacSecret: 'short' }), /at least 32 bytes/);
    const signed = new StenographerSupervisor({ enableSoftwareSigning: true });
    assert(signed.signingAuthority);
    assert(signed.signedLedger);
    assert.strictEqual(signed.getSignedAuditLedger().length, 0);
    assert.strictEqual(signed.verifySignedLedgerIntegrity().valid, true);
    signed._appendLedger('CHECKPOINT', { status: 'ok' });
    assert.strictEqual(signed.getSignedAuditLedger().length, 1);
    assert.strictEqual(signed.verifySignedLedgerIntegrity().valid, true);
  });

  check('StenographerSupervisor mock-mode connect/disconnect/status', async () => {
    const sv = new StenographerSupervisor({ mockMode: true });
    await sv.connect();
    assert.strictEqual(sv.isConnected, true);
    const status = await sv.getStatus();
    assert.strictEqual(status.alive, true);
    assert.strictEqual(status.ledgerKeyPersistence, 'session-only');
    await sv.disconnect();
    assert.strictEqual(sv.isConnected, false);
    const sv2 = new StenographerSupervisor({});
    await assert.rejects(() => sv2.connect(), /not configured/);
  });

  check('StenographerSupervisor proposeToolCall validation branches', () => {
    const sv = new StenographerSupervisor({ mockMode: true });
    assert.throws(() => sv.proposeToolCall({}), /toolName/);
    assert.throws(() => sv.proposeToolCall({ toolName: 'nope', originatingProjectRevision: 1 }), /Unregistered/);
    assert.throws(
      () =>
        sv.proposeToolCall({
          toolName: 'robotics.solve_kinematics',
          approvalClass: 'MUTATION_PREVIEW',
          originatingProjectRevision: 1
        }),
      /Approval class/
    );
    assert.throws(() => sv.proposeToolCall({ toolName: 'robotics.solve_kinematics' }), /project revision/);
    const p1 = sv.proposeToolCall({
      toolName: 'robotics.solve_kinematics',
      originatingProjectRevision: 1,
      args: { operation: 'forward_kinematics' }
    });
    assert.strictEqual(p1.status, 'PROPOSED');
    assert.throws(
      () =>
        sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1, proposalId: p1.id }),
      /Duplicate/
    );
    sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1, idempotencyKey: 'k1' });
    assert.throws(
      () =>
        sv.proposeToolCall({
          toolName: 'robotics.solve_kinematics',
          originatingProjectRevision: 1,
          idempotencyKey: 'k1'
        }),
      /idempotency key/
    );
    assert.throws(() => sv.proposeToolCall(null), /Invalid proposal input/);
  });

  check('StenographerSupervisor auto-run read-only proposal', () => {
    const sv = new StenographerSupervisor({ mockMode: true });
    const tool = sv.tools.get('robotics.solve_kinematics');
    assert(tool);
    sv.registerTool(
      new ToolDefinition({
        name: 'diag.readonly_check',
        description: 'Diagnostic read-only check',
        approvalClass: 'READ_ONLY',
        classification: 'READ_ONLY',
        modifiesState: false,
        autoRun: true
      })
    );
    const proposal = sv.proposeToolCall({ toolName: 'diag.readonly_check', originatingProjectRevision: 1 });
    assert.strictEqual(proposal.status, 'APPROVED');
    assert.strictEqual(proposal.requiresApproval, false);
    assert(proposal._approvalRecord && proposal._approvalRecord.decision === 'APPROVED');
    const compute = sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1 });
    assert.strictEqual(compute.status, 'PROPOSED');
    assert.strictEqual(compute.requiresApproval, true);
  });

  check('StenographerSupervisor processQuery branches', () => {
    const sv = new StenographerSupervisor({ mockMode: true });
    const list = sv.processQuery('list tools');
    assert.strictEqual(list.success, true);
    assert.strictEqual(list.queryType, 'list_tools');
    const ledger = sv.processQuery('verify ledger');
    assert.strictEqual(ledger.integrity.valid, true);
    const proj = sv.processQuery({ prompt: 'project status', context: { projectSummary: { revision: 3 } } });
    assert.strictEqual(proj.queryType, 'project_status');
    assert.strictEqual(proj.projectStatus.revision, 3);
    const caps = sv.processQuery('domain capabilities');
    assert.strictEqual(caps.success, true);
    const robotics = sv.processQuery({ prompt: 'robotics inverse dynamics', projectRevision: 4 });
    assert.strictEqual(robotics.status, 'PROPOSAL_CREATED');
    assert.strictEqual(robotics.proposal.toolName, 'robotics.solve_kinematics');
    assert.strictEqual(robotics.proposal.args.operation, 'inverse_dynamics');
    const steam = sv.processQuery({ prompt: 'steam 10 MPa 500 K', projectRevision: 4 });
    assert.strictEqual(steam.proposal.toolName, 'plant.calculate_steam_properties');
    assert.strictEqual(steam.proposal.args.pressurePa, 1e7);
    assert.strictEqual(steam.proposal.args.temperatureK, 500);
    const eda = sv.processQuery({ prompt: 'synthesize verilog', projectRevision: 4 });
    assert.strictEqual(eda.status, 'PROPOSAL_CREATED');
    assert.strictEqual(eda.proposal.toolName, 'eda.synthesize_logic');
    const cfd = sv.processQuery({ prompt: 'cfd simulation', projectRevision: 4 });
    assert.strictEqual(cfd.status, 'PROPOSAL_CREATED');
    assert.strictEqual(cfd.proposal.toolName, 'cfd.fvm_navier_stokes_3d');
    const unavailableTool = sv.processQuery({ prompt: 'rcwa grating simulation', projectRevision: 4 });
    assert.strictEqual(unavailableTool.success, false);
    assert.strictEqual(unavailableTool.status, 'UNAVAILABLE');
    const cad = sv.processQuery({ prompt: 'modify extrude 5 mm', projectRevision: 4 });
    assert.strictEqual(cad.success, false);
    assert.strictEqual(cad.status, 'UNAVAILABLE');
    const noRevision = sv.processQuery({ prompt: 'robotics forward kinematics' });
    assert.strictEqual(noRevision.status, 'INPUT_REQUIRED');
    const unknown = sv.processQuery('nothing matches anything');
    assert.strictEqual(unknown.success, false);
    assert.strictEqual(unknown.status, 'UNAVAILABLE');
  });

  check('StenographerSupervisor evaluateProposal branches', () => {
    const sv = new StenographerSupervisor({ mockMode: true });
    const p = sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1 });
    assert.throws(() => sv.evaluateProposal('missing-proposal', 'APPROVED'), /No tool proposal/);
    const approved = sv.evaluateProposal({
      proposalId: p.id,
      decision: 'APPROVED',
      rationale: 'ok',
      decidedBy: 'lead'
    });
    assert.strictEqual(approved.decision, 'APPROVED');
    assert.strictEqual(approved.approvedBy, 'lead');
    assert.throws(() => sv.evaluateProposal(p.id, 'APPROVED'), /no longer pending/);
    const p2 = sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1 });
    const rejected = sv.evaluateProposal(p2.id, 'REJECTED', 'bad idea', 'reviewer');
    assert.strictEqual(rejected.decision, 'REJECTED');
    const p3 = sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1 });
    const boolApproved = sv.evaluateProposal(p3.id, true, 'reviewer');
    assert.strictEqual(boolApproved.decision, 'APPROVED');
    const p4 = sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1 });
    const boolRejected = sv.evaluateProposal(p4.id, false, 'reviewer');
    assert.strictEqual(boolRejected.decision, 'REJECTED');
  });

  check('StenographerSupervisor executeTool fail-closed gate and executor path', async () => {
    const sv = new StenographerSupervisor({ mockMode: true });
    const pending = sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1 });
    await assert.rejects(() => sv.executeTool(pending.id), /Fail-closed gate/);
    const approved = sv.proposeToolCall({
      toolName: 'robotics.solve_kinematics',
      originatingProjectRevision: 1,
      args: { operation: 'forward_kinematics' }
    });
    sv.evaluateProposal(approved.id, 'APPROVED');
    const executed = await sv.executeTool(approved.id, async (params) => ({ echo: params.operation }));
    assert.strictEqual(executed.success, true);
    assert.strictEqual(executed.result.echo, 'forward_kinematics');
    assert(executed.artifactRef && executed.artifactRef.hash);
    await assert.rejects(() => sv.executeTool('missing'), /Proposal not found/);
    const badClass = sv.proposeToolCall({
      toolName: 'robotics.solve_kinematics',
      originatingProjectRevision: 1,
      proposalId: 'special-id'
    });
    sv.evaluateProposal(badClass.id, 'APPROVED');
    const savedTool = sv.tools.get('robotics.solve_kinematics');
    sv.tools.delete('robotics.solve_kinematics');
    await assert.rejects(() => sv.executeTool(badClass.id), /unregistered|approval class/);
    sv.tools.set('robotics.solve_kinematics', savedTool);
  });

  check('StenographerSupervisor executeTool failure records ledger and marks failed', async () => {
    const sv = new StenographerSupervisor({ mockMode: true });
    const p = sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1 });
    sv.evaluateProposal(p.id, 'APPROVED');
    await assert.rejects(
      () =>
        sv.executeTool(p.id, async () => {
          throw new Error('boom');
        }),
      /boom/
    );
    assert.strictEqual(p.status, 'FAILED');
    const ledger = sv.getAuditLedger();
    assert(ledger.some((e) => e.type === 'TOOL_FAILED'));
  });

  check('StenographerSupervisor verifyLedgerIntegrity tamper branches', () => {
    const sv = new StenographerSupervisor({ mockMode: true, hmacSecret: 'y'.repeat(32) });
    sv.proposeToolCall({ toolName: 'robotics.solve_kinematics', originatingProjectRevision: 1 });
    assert.strictEqual(sv.verifyLedgerIntegrity().valid, true);

    const svHead = new StenographerSupervisor({ mockMode: true, hmacSecret: 'a'.repeat(32) });
    svHead._appendLedger('CHECKPOINT', {});
    svHead.latestHash = 'ab'.repeat(32);
    const head = svHead.verifyLedgerIntegrity();
    assert.strictEqual(head.valid, false);
    assert(head.error.includes('head'));

    const svSeq = new StenographerSupervisor({ mockMode: true, hmacSecret: 'b'.repeat(32) });
    const firstEntry = svSeq._appendLedger('CHECKPOINT', { status: 1 });
    svSeq.ledger[0] = new LedgerEntry({
      sequenceNumber: 99,
      prevHash: firstEntry.prevHash,
      type: 'CHECKPOINT',
      payload: { status: 1 },
      timestamp: firstEntry.timestamp,
      hmacSecret: svSeq.hmacSecret
    });
    svSeq.latestHash = svSeq.ledger[0].hash;
    const seq = svSeq.verifyLedgerIntegrity();
    assert.strictEqual(seq.valid, false);
    assert(seq.error.includes('sequence'));

    const svLink = new StenographerSupervisor({ mockMode: true, hmacSecret: 'c'.repeat(32) });
    const e1 = svLink._appendLedger('CHECKPOINT', { status: 1 });
    const e2 = svLink._appendLedger('CHECKPOINT', { status: 2 });
    const forged2 = new LedgerEntry({
      sequenceNumber: e2.sequenceNumber,
      prevHash: '11'.repeat(32),
      type: 'CHECKPOINT',
      payload: { status: 2 },
      timestamp: e2.timestamp,
      hmacSecret: svLink.hmacSecret
    });
    svLink.ledger[1] = forged2;
    svLink.latestHash = forged2.hash;
    const link = svLink.verifyLedgerIntegrity();
    assert.strictEqual(link.valid, false);
    assert.strictEqual(link.tamperedIndex, 1);
    assert(link.error.includes('prevHash'));

    const svSig = new StenographerSupervisor({ mockMode: true, hmacSecret: 'd'.repeat(32) });
    const s1 = svSig._appendLedger('CHECKPOINT', {});
    const forgedSig = new LedgerEntry({
      sequenceNumber: s1.sequenceNumber,
      prevHash: s1.prevHash,
      type: 'CHECKPOINT',
      payload: {},
      timestamp: s1.timestamp,
      hmacSecret: 'e'.repeat(32)
    });
    svSig.ledger[0] = forgedSig;
    svSig.latestHash = forgedSig.hash;
    const sig = svSig.verifyLedgerIntegrity();
    assert.strictEqual(sig.valid, false);
    assert(sig.error.includes('signature'));
  });

  check('StenographerSupervisor daemon exit/restart budget branches', async () => {
    const events = [];
    const sv = new StenographerSupervisor({ maxRestarts: 2, daemonPath: null });
    sv.on('daemon:restarting', (e) => events.push(['restarting', e.attempt]));
    sv.on('daemon:exhausted', (e) => events.push(['exhausted', e.restartCount]));
    sv.on('daemon:error', () => events.push(['error']));
    const fakeChild = { pid: 123, kill: () => {} };
    sv.process = fakeChild;
    sv.isConnected = true;
    sv._handleDaemonExit(fakeChild, 1, 'SIGTERM');
    assert.strictEqual(sv.isConnected, false);
    let exhausted = false;
    for (let i = 0; i < 60 && !exhausted; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      exhausted = events.some(([k]) => k === 'exhausted');
    }
    assert.strictEqual(sv.restartCount, 2);
    assert(events.some(([k]) => k === 'restarting'));
    assert(exhausted);
    const sv2 = new StenographerSupervisor({ maxRestarts: 5, mockMode: true });
    sv2._disconnecting = true;
    sv2._scheduleRestart();
    assert.strictEqual(sv2.restartCount, 0);
    assert.strictEqual(sv2._restartTimer, null);
  });

  check('StenographerSupervisor daemon line parsing branches', () => {
    const sv = new StenographerSupervisor({ mockMode: true });
    const messages = [];
    const parseErrors = [];
    sv.on('daemon:message', (m) => messages.push(m));
    sv.on('daemon:parse_error', (e) => parseErrors.push(e));
    sv._handleDaemonLine('');
    sv._handleDaemonLine(JSON.stringify({ kind: 'ok' }));
    sv._handleDaemonLine('not-json');
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(parseErrors.length, 1);
  });

  // ------------------------------------------------------------------
  // src/ui/app.js: renderer orchestration via DOM stubs
  // ------------------------------------------------------------------
  check('App.js DOMContentLoaded orchestration wires command palette and job monitor', async () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'ui', 'app.js'), 'utf8');
    const runtimeErrors = [];
    const beforeCount = domListeners['DOMContentLoaded'] ? domListeners['DOMContentLoaded'].length : 0;
    vm.runInThisContext(src, { filename: 'app.js' });
    const loadedListeners = domListeners['DOMContentLoaded'] || [];
    assert(loadedListeners.length > beforeCount, 'expected DOMContentLoaded listener');
    for (let i = beforeCount; i < loadedListeners.length; i++) {
      await Promise.resolve(loadedListeners[i]()).catch((err) => runtimeErrors.push(String((err && err.stack) || err)));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.strictEqual(runtimeErrors.length, 0);
    assert.strictEqual(typeof global.OmniJobMonitor, 'object');
    assert.strictEqual(typeof global.omniSubmitComputeJob, 'function');
    assert.strictEqual(typeof global.omniSubmitHpcJob, 'function');
    assert(Array.isArray(global.__omniSessionSolves));
    assert.strictEqual(typeof global.omniAppState, 'object');
  });

  check('App.js explicit-cam request parsing branches', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'ui', 'app.js'), 'utf8');
    vm.runInThisContext(src, { filename: 'app-cam.js' });
    const getExplicit = global.getExplicitCamRequest;
    assert.strictEqual(typeof getExplicit, 'function');
    const empty = getExplicit();
    assert.strictEqual(empty.request, null);
    assert(empty.reason.includes('missing'));
    const set = (id, value) => {
      document.getElementById(id).value = value;
    };
    set('cam-bound-min-x', '0');
    set('cam-bound-max-x', '100');
    set('cam-bound-min-y', '0');
    set('cam-bound-max-y', '100');
    set('cam-bound-min-z', '0');
    set('cam-bound-max-z', '50');
    document.getElementById('select-cam-tool').value = 'flat_end_mill:6.35';
    set('input-cam-spindle', '8000');
    set('input-cam-feed', '800');
    set('input-cam-plunge', '200');
    set('input-cam-stepover', '2');
    set('input-cam-stepdown', '1');
    set('input-cam-safe-z', '20');
    set('input-cam-program-number', 'O0001');
    const valid = getExplicit();
    assert(valid.request);
    assert.strictEqual(valid.request.programNumber, 'O0001');
    assert.strictEqual(valid.request.options.toolDiameter, 6.35);
    assert.strictEqual(valid.request.options.toolType, 'flat_end_mill');
    assert.strictEqual(valid.request.bounds.maxX, 100);
    document.getElementById('input-cam-program-number').value = 'X99';
    const badProgram = getExplicit();
    assert.strictEqual(badProgram.request, null);
    assert(badProgram.reason.includes('O-number'));
    document.getElementById('input-cam-program-number').value = 'O0001';
    document.getElementById('input-cam-feed').value = 'not-a-number';
    const badFeed = getExplicit();
    assert.strictEqual(badFeed.request, null);
    assert(badFeed.reason.includes('feedRateMmMin'));
    document.getElementById('input-cam-feed').value = '800';
    document.getElementById('select-cam-tool').value = '';
    const noTool = getExplicit();
    assert.strictEqual(noTool.request, null);
    assert(noTool.reason.includes('toolDiameter'));
  });

  check('App.js error listeners and panel host mount branches', async () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'ui', 'app.js'), 'utf8');
    const runtimeErrors = [];
    const beforeCount = domListeners['DOMContentLoaded'] ? domListeners['DOMContentLoaded'].length : 0;
    vm.runInThisContext(src, { filename: 'app-panels.js' });
    const loadedListeners = domListeners['DOMContentLoaded'] || [];
    for (let i = beforeCount; i < loadedListeners.length; i++) {
      await Promise.resolve(loadedListeners[i]()).catch((err) => runtimeErrors.push(String((err && err.stack) || err)));
    }
    const windowErrorListeners = domListeners['error'] || [];
    const rejectionListeners = domListeners['unhandledrejection'] || [];
    assert.strictEqual(runtimeErrors.length, 0);
    assert(windowErrorListeners.length > 0, 'expected window error listener');
    assert(rejectionListeners.length > 0, 'expected unhandledrejection listener');
    global.dispatchEvent('error', { error: new Error('renderer crash'), message: 'renderer crash' });
    global.dispatchEvent('unhandledrejection', { reason: new Error('rejected promise') });
    assert.strictEqual(typeof global.refreshStenographerBadge, 'function');
    assert.strictEqual(typeof global.renderStenographerProposalCard, 'function');
  });

  // ------------------------------------------------------------------
  // Orchestrator summary
  // ------------------------------------------------------------------
  for (const task of tasks) {
    await Promise.race([
      task(),
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('check exceeded 300s time budget')), 300000))
    ]);
  }

  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (_) {}

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapThirtyOneCoverageTests };

if (require.main === module) {
  runBranchGapThirtyOneCoverageTests().then((stats) => {
    console.log(`gap31: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
