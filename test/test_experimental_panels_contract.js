/**
 * Experimental capability panels contract test.
 *
 * Exercises the three new read-only IPC routes end-to-end through the real
 * guarded handlers (sender guard + schema validation + real computation), then
 * feeds the responses into the renderer-side view functions (FakeElement DOM)
 * and verifies pure parsing/model helpers for each of the four new panels:
 *
 *   1. Materials catalog viewer        omni:materials-catalog-query
 *   2. Optics glass lookup             omni:optics-glass-lookup
 *   3. AI surrogate trainer            omni:ai-train-surrogate / omni:ai-predict-surrogate
 *   4. HPC local dispatch              omni:hpc-local-dispatch
 *
 * No mocks for the real computation paths; the HPC dispatch runs the real
 * local multiprocess worker on a small N.
 */

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  dialog: {}
};

const originalLoad = Module._load;
Module._load = function loadWithElectronIpcMock(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

let registerAllIpcHandlers;
let defineHandlerModule;
try {
  ({ registerAllIpcHandlers } = require('../src/main/ipc/index'));
  defineHandlerModule = require('../src/main/ipc/define_handler');
} finally {
  Module._load = originalLoad;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.textContent = '';
    this.attributes = {};
    this.value = '';
    this.type = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this.rows = '';
    this.placeholder = '';
    this.spellcheck = false;
    this.listeners = {};
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    this.textContent = '';
    children.forEach((child) => this.appendChild(child));
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  get allText() {
    return [this.textContent, ...this.children.map((child) => child.allText)].filter(Boolean).join(' ');
  }
}

const fakeDocument = {
  createElement: (tagName) => new FakeElement(tagName),
  createElementNS: (_namespace, tagName) => new FakeElement(tagName)
};

function hasTag(element, tagName) {
  if (element.tagName === tagName) return true;
  return (element.children || []).some((child) => hasTag(child, tagName));
}

function isFiniteDeep(value, seen = new Set()) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return Array.from(value).every(Number.isFinite);
  return Object.values(value).every((entry) => isFiniteDeep(entry, seen));
}

async function runExperimentalPanelsContractTests() {
  let passed = 0;
  let failed = 0;
  const record = (name, ok, detail = '') => {
    if (ok) {
      passed++;
      console.log(`  ✓ PASS ${name}${detail ? ` [${detail}]` : ''}`);
    } else {
      failed++;
      console.error(`  ✗ FAIL ${name}${detail ? ` [${detail}]` : ''}`);
    }
  };

  defineHandlerModule.channelRegistry.clear();
  handlers.clear();
  registerAllIpcHandlers({ ipcMain: electronMock.ipcMain });

  const entryUrl = pathToFileURL(path.join(repositoryRoot, 'src', 'index.html')).href;
  const trustedEvent = {
    sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
    senderFrame: { frameTreeNodeId: 42, url: entryUrl }
  };

  const NEW_CHANNELS = [
    'omni:materials-catalog-query',
    'omni:optics-glass-lookup',
    'omni:hpc-local-dispatch',
    'omni:ai-train-surrogate',
    'omni:ai-predict-surrogate'
  ];
  for (const channel of NEW_CHANNELS) {
    record(`channel registered ${channel}`, handlers.has(channel));
  }

  // 1. Materials catalog IPC end-to-end
  {
    const materials = await handlers.get('omni:materials-catalog-query')(trustedEvent, {});
    record('materials catalog returns success', materials.success === true);
    record(
      'materials catalog has cards',
      Array.isArray(materials.cards) && materials.cards.length > 0,
      String(materials.count)
    );
    const aluminum = materials.cards.find((card) => card.id === 'AL-7075-T6');
    record('materials catalog includes AL-7075-T6', Boolean(aluminum));
    if (aluminum) {
      record('materials card has finite E/nu/rho/Sy', isFiniteDeep(aluminum));
      record('materials card E at 293 K', typeof aluminum.E293Pa === 'number' && aluminum.E293Pa > 0);
      record(
        'materials card source provenance',
        typeof aluminum.source?.reference === 'string' && aluminum.source.reference.length > 0
      );
    }
    const hot = await handlers.get('omni:materials-catalog-query')(trustedEvent, { search: 'AL-', temperatureK: 489 });
    record(
      'materials search filter returns matches',
      hot.cards.length === 3 && hot.cards.every((card) => /al-/i.test(`${card.id} ${card.name}`))
    );
    record(
      'materials temperature interpolation changes E',
      hot.cards.some((card) => card.EAtTemperatureKPa !== card.E293Pa)
    );
    let invalidTempRejected = false;
    try {
      await handlers.get('omni:materials-catalog-query')(trustedEvent, { temperatureK: 0 });
    } catch {
      invalidTempRejected = true;
    }
    record('materials schema rejects out-of-range temperature', invalidTempRejected);
  }

  // 2. Optics glass lookup IPC end-to-end
  {
    const wavelengths = [0.4, 0.48613, 0.58756, 0.65627, 0.8, 1.0];
    const glasses = await handlers.get('omni:optics-glass-lookup')(trustedEvent, {
      query: 'N-BK7',
      wavelengthsUm: wavelengths
    });
    record('glass lookup returns success', glasses.success === true);
    record('glass lookup finds N-BK7', Array.isArray(glasses.glasses) && glasses.glasses.length === 1);
    const bk7 = glasses.glasses?.[0];
    if (bk7) {
      record(
        'glass record has Sellmeier B/C triples',
        Array.isArray(bk7.sellmeier?.B) &&
          bk7.sellmeier.B.length === 3 &&
          Array.isArray(bk7.sellmeier?.C) &&
          bk7.sellmeier.C.length === 3
      );
      record('glass nd near 1.5168', Math.abs(bk7.nd - 1.5168) < 0.002, String(bk7.nd));
      record('glass Vd near 64.2', Math.abs(bk7.Abbe_Vd - 64.2) < 1.0, String(bk7.Abbe_Vd));
      record('glass spectrum is finite', isFiniteDeep(bk7.spectrum) && bk7.spectrum.length === wavelengths.length);
      record('glass n(lambda) is decreasing across visible', bk7.spectrum[1].index > bk7.spectrum[3].index);
    }
    let invalidSpectrumRejected = false;
    try {
      await handlers.get('omni:optics-glass-lookup')(trustedEvent, { wavelengthsUm: [0.4] });
    } catch {
      invalidSpectrumRejected = true;
    }
    record('glass schema rejects too-short wavelength list', invalidSpectrumRejected);
  }

  // 3. AI surrogate IPC end-to-end (train + predict)
  {
    const dataset = {
      inputs: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
        [2, 1]
      ],
      outputs: [[0], [1], [1], [2], [3]]
    };
    const trained = await handlers.get('omni:ai-train-surrogate')(trustedEvent, { dataset });
    record('surrogate train returns success', trained.success === true);
    record(
      'surrogate training returns model + lossHistory',
      Boolean(trained.model) && Array.isArray(trained.lossHistory) && trained.lossHistory.length > 0
    );
    record('surrogate loss history is finite', trained.lossHistory.every(Number.isFinite));
    if (trained.success === true) {
      const predicted = await handlers.get('omni:ai-predict-surrogate')(trustedEvent, {
        model: trained.model,
        x: [[1, 1]]
      });
      record('surrogate predict returns success', predicted.success === true);
      record(
        'surrogate predict output is finite',
        isFiniteDeep(predicted.predictions) && predicted.predictions.length === 1
      );
    }
  }

  // 4. HPC local dispatch IPC end-to-end (real worker process)
  {
    const response = await handlers.get('omni:hpc-local-dispatch')(trustedEvent, { n: 16 });
    record('hpc local dispatch returns success', response.success === true, response.status || 'no status');
    record('hpc local dispatch reaches COMPLETED', response.status === 'COMPLETED');
    const transitionTo = (response.transitions || []).map((transition) => transition.to);
    record(
      'hpc transitions include QUEUED → RUNNING → COMPLETED',
      transitionTo.includes('QUEUED') && transitionTo.includes('RUNNING') && transitionTo.includes('COMPLETED')
    );
    record(
      'hpc result has finite relative residual',
      typeof response.result?.relativeResidual === 'number' &&
        Number.isFinite(response.result.relativeResidual) &&
        response.result.relativeResidual < 1e-6,
      String(response.result?.relativeResidual)
    );
    record(
      'hpc result has 64-char checksum',
      typeof response.result?.checksum === 'string' && response.result.checksum.length === 64
    );
    record(
      'hpc result solution is finite',
      isFiniteDeep(response.result?.solution) && response.result.solution.length === 16 * 16
    );
    let invalidNRejected = false;
    try {
      await handlers.get('omni:hpc-local-dispatch')(trustedEvent, { n: 4 });
    } catch {
      invalidNRejected = true;
    }
    record('hpc schema rejects N below minimum', invalidNRejected);
    const { shutdownSharedLocalCluster } = require('../src/core/hpc/hpc_engine_adapter');
    shutdownSharedLocalCluster();
  }

  // Renderer-side view functions (pure DOM rendering)
  {
    const { renderCatalog, filterCards, formatGPa } = require('../src/ui/materials_catalog_view');
    const hostile = '</span><img src=x onerror=alert(1)>';
    const fakeCards = [
      {
        id: 'AL-7075-T6',
        name: 'Aluminum alloy 7075-T6',
        class: 'Aluminum alloy',
        source: { reference: 'MIL-HDBK-5J' },
        validationStatus: 'documented-typical',
        nu: 0.33,
        rhoKgM3: 2810,
        E293Pa: 71.7e9,
        Sy293Pa: 503e6,
        EAtTemperatureKPa: 64.1e9
      },
      {
        id: hostile,
        name: hostile,
        class: hostile,
        source: { reference: hostile },
        validationStatus: hostile,
        nu: hostile,
        rhoKgM3: Number.NaN,
        E293Pa: hostile,
        Sy293Pa: hostile,
        EAtTemperatureKPa: Number.POSITIVE_INFINITY
      }
    ];
    const container = new FakeElement('div');
    assert.strictEqual(renderCatalog(fakeDocument, container, fakeCards, 489, 'note').success, true);
    assert.match(container.allText, /AL-7075-T6/);
    assert.match(container.allText, /E at 489 K 64\.10 GPa/);
    assert.match(container.allText, /documented-typical/);
    assert.strictEqual(hasTag(container, 'img'), false);
    assert.deepStrictEqual(
      filterCards(fakeCards, 'AL-').map((card) => card.id),
      ['AL-7075-T6']
    );
    assert.strictEqual(formatGPa(71.7e9), '71.70 GPa');
    assert.strictEqual(formatGPa(Number.NaN), 'Unavailable');
  }

  {
    const { buildSpectrumModel, renderSpectrumSvg, renderGlassDetails } = require('../src/ui/optics_glass_lookup_view');
    const spectrum = [
      { wavelengthUm: 0.4, index: 1.5302 },
      { wavelengthUm: 0.5, index: 1.5216 },
      { wavelengthUm: 0.6, index: 1.5163 },
      { wavelengthUm: 0.7, index: 1.5129 }
    ];
    const model = buildSpectrumModel(spectrum);
    assert.strictEqual(model.success, true);
    assert.strictEqual(model.points.length, 4);
    assert.ok(
      model.points.every((point) => point.x > 0 && point.y > 0 && Number.isFinite(point.x) && Number.isFinite(point.y))
    );
    const svg = new FakeElement('div');
    assert.strictEqual(renderSpectrumSvg(fakeDocument, svg, model).success, true);
    const polyline = svg.children[0]?.children?.[0];
    assert.strictEqual(svg.children[0].tagName, 'svg');
    assert.strictEqual(polyline?.tagName, 'polyline');
    assert.ok(typeof polyline.attributes.points === 'string' && polyline.attributes.points.includes(' '));
    assert.strictEqual(buildSpectrumModel([{ wavelengthUm: 1, index: 2 }]).success, false);

    const details = new FakeElement('div');
    const hostile = '</span><img src=x onerror=alert(1)>';
    assert.strictEqual(
      renderGlassDetails(fakeDocument, details, {
        name: hostile,
        supplier: 'SCHOTT',
        type: 'optical-glass',
        nd: 1.5168,
        Abbe_Vd: 64.2,
        sellmeier: { B: [1, 2, 3], C: [0.006, 0.02, 103.5] },
        dndTPerK: 1.86e-6,
        dataStatus: 'datasheet-published',
        provenance: { note: 'datasheet' }
      }).success,
      true
    );
    assert.strictEqual(hasTag(details, 'img'), false);
    assert.match(details.allText, /1\.000e\+0, 2\.000e\+0, 3\.000e\+0/);
  }

  {
    const {
      parseCsv,
      buildLossLineModel,
      renderLossSvg,
      parsePredictInput
    } = require('../src/ui/ai_surrogate_trainer_view');
    const csv = '0,0,0\n1,0,1\n0,1,1\n1,1,2\n2,1,3';
    const parsed = parseCsv(csv);
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.rowCount, 5);
    assert.deepStrictEqual(parsed.inputs[3], [1, 1]);
    assert.deepStrictEqual(parsed.outputs[3], [2]);
    assert.strictEqual(parseCsv('0,0\n1,1').success, false);
    assert.strictEqual(parseCsv('a,b,c').success, false);

    const loss = buildLossLineModel([10, 8, 6, 4, 2]);
    assert.strictEqual(loss.success, true);
    assert.strictEqual(loss.points.length, 5);
    assert.ok(loss.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
    const svg = new FakeElement('div');
    assert.strictEqual(renderLossSvg(fakeDocument, svg, loss).success, true);
    assert.strictEqual(svg.children[0].tagName, 'svg');
    assert.strictEqual(buildLossLineModel([1, Number.NaN]).success, false);
    assert.deepStrictEqual(parsePredictInput('1', '2'), { success: true, input: [1, 2] });
    assert.strictEqual(parsePredictInput('a', '2').success, false);
  }

  {
    const { renderTransitions, renderResult } = require('../src/ui/hpc_local_dispatch_view');
    const hostiles = [
      { from: 'QUEUED', to: '</span><img src=x onerror=alert(1)>', event: 'submit', at: '2026-11-01T00:00:00.000Z' }
    ];
    const transitionsContainer = new FakeElement('div');
    assert.strictEqual(renderTransitions(fakeDocument, transitionsContainer, hostiles).success, true);
    assert.strictEqual(hasTag(transitionsContainer, 'img'), false);

    const resultContainer = new FakeElement('div');
    const response = {
      success: true,
      jobId: 'local_abc_1',
      status: 'COMPLETED',
      provider: 'local',
      scheduler: 'LOCAL_MULTIPROCESS',
      executionDurationMs: 42,
      result: { relativeResidual: 1.2e-9, checksum: 'a'.repeat(64), iterations: 12, converged: true, solution: [0, 1] }
    };
    assert.strictEqual(renderResult(fakeDocument, resultContainer, response).success, true);
    assert.match(resultContainer.allText, /1\.200e-9/);
    assert.match(resultContainer.allText, /aaaaaaaaaaaaaaaa/);
    const failed = new FakeElement('div');
    assert.strictEqual(
      renderResult(fakeDocument, failed, { success: false, error: { message: 'oops' } }).success,
      true
    );
    assert.match(failed.allText, /oops/);
  }

  // Source-text gates
  {
    const appSource = fs.readFileSync(path.join(repositoryRoot, 'src', 'ui', 'app.js'), 'utf8');
    for (const name of [
      'OmniMaterialsCatalogView',
      'OmniOpticsGlassLookupView',
      'OmniAiSurrogateTrainerView',
      'OmniHpcLocalDispatchView'
    ]) {
      record(`app.js mounts ${name}`, appSource.includes(name));
    }
    const viewFiles = [
      'materials_catalog_view.js',
      'optics_glass_lookup_view.js',
      'ai_surrogate_trainer_view.js',
      'hpc_local_dispatch_view.js'
    ];
    for (const file of viewFiles) {
      const source = fs.readFileSync(path.join(repositoryRoot, 'src', 'ui', file), 'utf8');
      record(`view ${file} has no innerHTML sink`, !/\.innerHTML\s*=/.test(source));
      record(`view ${file} has no Math.random`, !/Math\.random/.test(source));
    }
    const preloadSource = fs.readFileSync(path.join(repositoryRoot, 'preload.js'), 'utf8');
    for (const method of [
      'materialsCatalogQuery',
      'opticsGlassLookup',
      'aiTrainSurrogate',
      'aiPredictSurrogate',
      'hpcLocalDispatch'
    ]) {
      record(`preload exposes ${method}`, preloadSource.includes(method));
    }
  }

  console.log(
    failed === 0
      ? `Experimental panels contract passed (${passed} checks).`
      : `Experimental panels contract FAILED (${failed} checks).`
  );
  return { total: passed + failed, passed, failed };
}

if (require.main === module) {
  runExperimentalPanelsContractTests()
    .then((stats) => {
      if (stats.failed > 0) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runExperimentalPanelsContractTests };
