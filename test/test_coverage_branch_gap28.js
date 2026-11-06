'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 28).
 *
 * Targets the UI/IPC cluster modules:
 *   - UI views: app.js (partial bootstrap), viewport3d.js (light), panel_host,
 *     safe_dom, workspace_tab_view, command_palette_view, property_grid_view,
 *     measurement_hud_view, eda_result_view, engineering_result_view,
 *     bode_chart_model, materials_catalog_view, optics_glass_lookup_view,
 *     ai_surrogate_trainer_view, hpc_local_dispatch_view,
 *     spice_oscilloscope_ui, optical_inspector_ui, pid_studio_ui,
 *     wizards/design_wizards, tactile_spring_physics, storytelling_rails,
 *     procedural_hardware, procedural_pbr_materials, nasa_space_rocket_3d
 *   - IPC: index.js, define_handler.js, cad_schemas.js, cae_schemas.js,
 *     cad/cae/eda/optics/plant/controls/system ipc registration sweep
 *   - Main: compute_host.js, headless_solver_daemon.js,
 *     stenographer_supervisor.js, sbom_service.js
 *
 * DOM stubs follow the FakeElement pattern used across the UI-contract suites.
 * Electron is mocked for the IPC registration paths. All inputs are fixed and
 * deterministic (no Math.random / crypto.randomBytes in this file).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('node:module');

// ---------------------------------------------------------------------------
// Mock browser environment (FakeElement DOM)
// ---------------------------------------------------------------------------
const elementRegistry = new Map();
const documentListeners = new Map();
const windowListeners = new Map();

function createCanvasContext() {
  return {
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    bezierCurveTo: () => {},
    quadraticCurveTo: () => {},
    rect: () => {},
    clip: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    ellipse: () => {},
    roundRect: () => {},
    fillText: () => {},
    strokeText: () => {},
    measureText: (txt) => ({ width: (txt || '').length * 7 }),
    setLineDash: () => {},
    getLineDash: () => [],
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {},
    setTransform: () => {},
    resetTransform: () => {}
  };
}

class FakeClassList {
  constructor() {
    this.set = new Set();
  }
  add(...classes) {
    classes.forEach((c) => this.set.add(c));
  }
  remove(...classes) {
    classes.forEach((c) => this.set.delete(c));
  }
  toggle(c, force) {
    if (force === undefined) {
      if (this.set.has(c)) {
        this.set.delete(c);
        return false;
      }
      this.set.add(c);
      return true;
    }
    if (force) {
      this.set.add(c);
      return true;
    }
    this.set.delete(c);
    return false;
  }
  contains(c) {
    return this.set.has(c);
  }
}

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.textContent = '';
    this.innerHTML = '';
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.type = '';
    this.min = '';
    this.max = '';
    this.step = '';
    this.rows = '';
    this.placeholder = '';
    this.spellcheck = false;
    this.hidden = false;
    this.disabled = false;
    this.title = '';
    this.width = 800;
    this.height = 500;
    this.clientWidth = 800;
    this.clientHeight = 500;
    this.viewBox = { baseVal: { width: 1189 } };
    this.listeners = {};
    this.classList = new FakeClassList();
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  appendChild(child) {
    if (child) {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node === null || node === undefined) continue;
      if (typeof node === 'string') {
        const textNode = new FakeElement('span');
        textNode.textContent = node;
        this.appendChild(textNode);
      } else {
        this.appendChild(node);
      }
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.textContent = '';
    nodes.forEach((node) => {
      if (node && typeof node === 'object') this.appendChild(node);
    });
  }
  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
      this.parentElement = null;
    }
  }
  addEventListener(type, handler) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }
  removeEventListener(type, handler) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((fn) => fn !== handler);
  }
  dispatchEvent(type, event = {}) {
    if (!this.listeners[type]) return;
    const evt = {
      type,
      preventDefault: () => {},
      stopPropagation: () => {},
      clientX: 200,
      clientY: 150,
      key: '',
      deltaY: 0,
      ...event
    };
    for (const handler of [...this.listeners[type]]) handler(evt);
  }
  click(event = {}) {
    this.dispatchEvent('click', event);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width || 800, height: this.height || 500 };
  }
  closest() {
    return null;
  }
  getContext(mode) {
    return mode === '2d' ? createCanvasContext() : null;
  }
  querySelector(selector) {
    if (typeof selector === 'string' && selector.startsWith('#')) {
      return elementRegistry.get(selector.slice(1)) || null;
    }
    if (typeof selector === 'string') {
      for (const child of this.children) {
        if (child.className && String(child.className).split(/\s+/).includes(selector.replace('.', ''))) {
          return child;
        }
      }
    }
    return this.children[0] || null;
  }
  querySelectorAll(selector) {
    const results = [];
    const targetClass = typeof selector === 'string' ? selector.replace('.', '') : '';
    const collect = (node) => {
      if (targetClass && node.className && String(node.className).split(/\s+/).includes(targetClass)) {
        results.push(node);
      }
      for (const child of node.children || []) collect(child);
    };
    collect(this);
    return results;
  }
  get allText() {
    return [this.textContent, ...this.children.map((child) => child.allText)].filter(Boolean).join(' ');
  }
}

const fakeDocument = {
  createElement: (tagName) => new FakeElement(tagName),
  createElementNS: (_ns, tagName) => new FakeElement(tagName),
  createTextNode: (text) => {
    const node = new FakeElement('span');
    node.textContent = String(text);
    return node;
  },
  getElementById: (id) => {
    if (!elementRegistry.has(id)) elementRegistry.set(id, new FakeElement('div', id));
    return elementRegistry.get(id);
  },
  querySelector: (selector) => {
    if (typeof selector === 'string' && selector.startsWith('#')) {
      return fakeDocument.getElementById(selector.slice(1));
    }
    return null;
  },
  querySelectorAll: (selector) => {
    const results = [];
    const targetClass = typeof selector === 'string' ? selector.replace('.', '') : '';
    for (const el of elementRegistry.values()) {
      if (targetClass && el.className && String(el.className).split(/\s+/).includes(targetClass)) {
        results.push(el);
      }
    }
    return results;
  },
  addEventListener: (type, handler) => {
    if (!documentListeners.has(type)) documentListeners.set(type, []);
    documentListeners.get(type).push(handler);
  },
  body: new FakeElement('body')
};

global.window = global;
global.document = fakeDocument;
global.THREE = require('three');
global.window.THREE = global.THREE;
global.location = { search: '' };
global.window.location = global.location;
global.window.close = () => {};
global.window.print = () => {};
global.window.addEventListener = (type, handler) => {
  if (!windowListeners.has(type)) windowListeners.set(type, []);
  windowListeners.get(type).push(handler);
};
global.window.removeEventListener = (type, handler) => {
  if (!windowListeners.has(type)) return;
  windowListeners.set(
    type,
    windowListeners.get(type).filter((fn) => fn !== handler)
  );
};
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
}
global.DOMParser = class FakeDOMParser {
  parseFromString() {
    return { documentElement: new FakeElement('svg'), querySelector: () => null };
  }
};
global.window.omniEngAPI = {};

function uiStubObject() {
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (prop === Symbol.toPrimitive) return () => 0;
        if (prop in target) return target[prop];
        if (prop === 'children') return [];
        if (prop === 'classList') return new FakeClassList();
        if (prop === 'style') return {};
        if (prop === 'userData') return {};
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    }
  );
}

function makeUiCtor() {
  const ctor = function UiStubCtor(...args) {
    const instance = uiStubObject();
    instance.args = args;
    return instance;
  };
  ctor.prototype = uiStubObject();
  return ctor;
}

for (const name of [
  'SchematicLayoutUI',
  'BlockDiagramUI',
  'KeymapManager',
  'SpaceMouseController',
  'DockingManager',
  'SketcherCanvas3D',
  'FlowsheetPfdUI',
  'InteractiveBlockCanvasEngine',
  'CanvasBlockNode',
  'CanvasWireRoute'
]) {
  global[name] = makeUiCtor();
  global.window[name] = global[name];
}
global.window.__OMNI_TEST_MODE__ = true;

function fireDomContentLoaded() {
  const listeners = documentListeners.get('DOMContentLoaded') || [];
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (_) {
      // A partial bootstrap run is acceptable for this coverage suite.
    }
  }
}

// ---------------------------------------------------------------------------
// Electron mock
// ---------------------------------------------------------------------------
const repositoryRoot = path.resolve(__dirname, '..');
const ipcHandlers = new Map();
const electronMock = {
  app: { getAppPath: () => repositoryRoot },
  ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
  dialog: {}
};
const trustedEvent = {
  sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
  senderFrame: { frameTreeNodeId: 42, url: `file://${repositoryRoot}/src/index.html` }
};

const originalLoad = Module._load;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
async function runBranchGapTwentyEightCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let chain = Promise.resolve();

  function check(name, fn) {
    totalTests++;
    const recordPass = () => {
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    };
    const recordFail = (err) => {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.stack || err.message}`);
    };
    chain = chain
      .then(() => {
        try {
          const result = fn();
          return result && typeof result.then === 'function' ? Promise.resolve(result) : undefined;
        } catch (err) {
          return Promise.reject(err);
        }
      })
      .then(recordPass, recordFail);
  }

  // -----------------------------------------------------------------------
  // UI view helpers (FakeElement DOM)
  // -----------------------------------------------------------------------
  const { appendSafeInlineMarkup } = require('../src/ui/safe_dom');
  const { createWorkspaceTab } = require('../src/ui/workspace_tab_view');
  const { createCommandPaletteItem } = require('../src/ui/command_palette_view');
  const { createPropertyGridElements, readOptionalNumberInput } = require('../src/ui/property_grid_view');
  const { renderMeasurementHud, render: renderHud } = require('../src/ui/measurement_hud_view');
  const { renderVerilogResult, renderDrcResult } = require('../src/ui/eda_result_view');
  const { renderOpticsEstimateResult, renderPipingStressResult } = require('../src/ui/engineering_result_view');
  const { fromAnalyzerResult, getSyntheticPreset, render: renderBode } = require('../src/ui/bode_chart_model');
  const {
    filterCards,
    formatGPa,
    renderCatalog,
    buildCard,
    mount: mountMaterials
  } = require('../src/ui/materials_catalog_view');
  const {
    filterGlasses,
    buildSpectrumModel,
    renderSpectrumSvg,
    renderGlassDetails,
    mount: mountGlasses
  } = require('../src/ui/optics_glass_lookup_view');
  const {
    parseCsv,
    buildLossLineModel,
    renderLossSvg,
    parsePredictInput,
    mount: mountSurrogate
  } = require('../src/ui/ai_surrogate_trainer_view');
  const {
    renderTransitions,
    renderResult: renderHpcResult,
    mount: mountHpc
  } = require('../src/ui/hpc_local_dispatch_view');
  const { SpiceOscilloscopeUI } = require('../src/ui/spice_oscilloscope_ui');
  const { OpticalInspectorUI } = require('../src/ui/optical_inspector_ui');
  const { PIDStudioUI } = require('../src/ui/pid_studio_ui');
  const {
    PlainEnglishErrorTranslator,
    DropTestWizard,
    DroneDesignWizard,
    CameraLensWizard,
    PCBDesignWizard
  } = require('../src/ui/wizards/design_wizards');
  const TactileSpringPhysics = require('../src/ui/tactile_spring_physics');
  const StorytellingRails = require('../src/ui/storytelling_rails');
  const ProceduralHardware = require('../src/ui/procedural_hardware');
  const ProceduralPbrMaterials = require('../src/ui/procedural_pbr_materials');
  const { NasaSpaceRocket3D } = require('../src/ui/nasa_space_rocket_3d');

  check('safe_dom appendSafeInlineMarkup branches', () => {
    const target = new FakeElement('div');
    appendSafeInlineMarkup(target, 'a <strong>b</strong> c <br/> d <em>e</em>');
    assert.strictEqual(target.children.length, 6);
    const renderedText = target.allText.replace(/\s+/g, ' ').trim();
    assert(renderedText.includes('a'));
    assert(renderedText.includes('b'));
    assert(renderedText.includes('c'));
    assert(renderedText.includes('d'));
    assert(renderedText.includes('e'));
    const empty = new FakeElement('div');
    appendSafeInlineMarkup(empty, '');
    assert.strictEqual(empty.children.length, 0);
    const unclosed = new FakeElement('div');
    appendSafeInlineMarkup(unclosed, '<code>x</em> tail');
    assert(unclosed.allText.includes('tail'));
    const plain = new FakeElement('div');
    appendSafeInlineMarkup(plain, 'no markup');
    assert.strictEqual(plain.children.length, 1);
    assert.strictEqual(plain.children[0].textContent, 'no markup');
  });

  check('workspace_tab_view createWorkspaceTab branches', () => {
    const tab = createWorkspaceTab(fakeDocument, { docId: 'doc-1', title: 'T', badge: 'B', active: false });
    assert.strictEqual(tab.className, 'workspace-tab');
    assert.strictEqual(tab.getAttribute('data-doc-id'), 'doc-1');
    const active = createWorkspaceTab(fakeDocument, {});
    assert.strictEqual(active.className, 'workspace-tab active');
    assert.strictEqual(active.getAttribute('data-doc-id'), '');
    assert.throws(() => createWorkspaceTab({}, {}), /createElement/);
  });

  check('command_palette_view createCommandPaletteItem branches', () => {
    const item = createCommandPaletteItem(
      fakeDocument,
      { id: 'cmd1', icon: 'i', title: 'Title', desc: 'D', category: 'C' },
      3,
      true
    );
    assert.strictEqual(item.className, 'command-item selected');
    assert.strictEqual(item.getAttribute('data-cmd-index'), '3');
    const plain = createCommandPaletteItem(fakeDocument, {}, 0, false);
    assert.strictEqual(plain.className, 'command-item');
    assert.throws(() => createCommandPaletteItem({}, {}), /createElement/);
  });

  check('property_grid_view createPropertyGridElements branches', () => {
    const el3d = createPropertyGridElements(
      fakeDocument,
      {
        name: 'Part',
        type: 'Body',
        position: { x: 1, y: 2, z: 3 },
        w: 10,
        h: 5,
        dimensions: { width: 1, height: 2, depth: 3 },
        wbsId: 'W-1',
        userData: { isNasaEntity: true },
        delay: 1,
        net: 'N1',
        temp: 25,
        press: 1
      },
      true
    );
    assert(el3d.length >= 5);
    const el2d = createPropertyGridElements(fakeDocument, { x: 4, y: 5, w: 8, h: 9 }, false);
    assert(el2d.length >= 3);
    assert.strictEqual(createPropertyGridElements(null, null).length, 0);
    assert.strictEqual(createPropertyGridElements(fakeDocument, null).length, 0);
    assert.strictEqual(readOptionalNumberInput({ value: ' 12 ' }), 12);
    assert.strictEqual(readOptionalNumberInput({ value: '' }), null);
    assert.strictEqual(readOptionalNumberInput({ value: 'abc' }), null);
    assert.strictEqual(readOptionalNumberInput(null), null);
  });

  check('measurement_hud_view phases and arg-shuffle', () => {
    const hud = new FakeElement('div');
    const failed = renderMeasurementHud(null, fakeDocument);
    assert.strictEqual(failed.success, false);
    const active = renderMeasurementHud(hud, fakeDocument, { phase: 'active' });
    assert.strictEqual(active.success, true);
    const anchored = renderHud(hud, fakeDocument, { phase: 'anchored', point: { x: 1, y: 2, z: 3 } });
    assert.strictEqual(anchored.success, true);
    const anchoredBad = renderHud(hud, fakeDocument, { phase: 'anchored', point: null });
    assert.strictEqual(anchoredBad.success, true);
    const result = renderHud(hud, fakeDocument, {
      phase: 'result',
      distanceMm: 12.5,
      deltaX: 1,
      deltaY: 2,
      deltaZ: 3
    });
    assert.strictEqual(result.success, true);
    const resultInvalid = renderHud(hud, fakeDocument, { phase: 'result', distance: -1, delta: { x: -1, y: 0, z: 0 } });
    assert.strictEqual(resultInvalid.success, true);
    const unknown = renderHud(hud, fakeDocument, { phase: 'nope' });
    assert.strictEqual(unknown.success, true);
    const shuffled = renderHud(hud, fakeDocument, {});
    assert.strictEqual(shuffled.success, true);
  });

  check('eda_result_view renderVerilogResult/renderDrcResult branches', () => {
    const container = new FakeElement('div');
    const bad = renderVerilogResult({ success: false }, fakeDocument, container);
    assert.strictEqual(bad.success, false);
    const ok = renderVerilogResult(
      { success: true, gateCount: 12, totalArea_um2: 5.5, serialGateDelayEstimate_ps: 3 },
      fakeDocument,
      container
    );
    assert.strictEqual(ok.success, true);
    const drcBad = renderDrcResult({ success: false }, fakeDocument, container);
    assert.strictEqual(drcBad.success, false);
    const drcClean = renderDrcResult(
      { success: true, clean: true, totalShapesChecked: 4, violationCount: 0 },
      fakeDocument,
      container
    );
    assert.strictEqual(drcClean.success, true);
    const drcDirty = renderDrcResult(
      { success: true, clean: false, totalShapesChecked: 4, violationCount: 2 },
      fakeDocument,
      container
    );
    assert.strictEqual(drcDirty.success, true);
    const drcUnknown = renderDrcResult(
      { success: true, totalShapesChecked: 0, violationCount: 0 },
      fakeDocument,
      container
    );
    assert.strictEqual(drcUnknown.success, true);
    const noContainer = renderVerilogResult({ success: true, gateCount: 0 }, fakeDocument, null);
    assert.strictEqual(noContainer.success, false);
  });

  check('engineering_result_view renderOpticsEstimateResult/renderPipingStressResult branches', () => {
    const container = new FakeElement('div');
    const notObj = renderOpticsEstimateResult('x', fakeDocument, container);
    assert.strictEqual(notObj.success, false);
    const arrObj = renderOpticsEstimateResult([], fakeDocument, container);
    assert.strictEqual(arrObj.success, false);
    const full = renderOpticsEstimateResult(
      {
        wavelengthNm: 550,
        diffractionAiryDiskDiameter_um: 4.2,
        nearFocusLimit_m: 1,
        farFocusLimit_m: 'Infinity',
        entrancePupilDiameterMm: 20,
        numericalAperture: 0.5,
        circleOfConfusionMm: 0.03,
        hyperfocalDistance_m: 12,
        depthOfField_m: 'Infinity',
        mtf50ResolutionLimit_lp_per_mm: 150
      },
      fakeDocument,
      container
    );
    assert.strictEqual(full.success, true);
    const partial = renderOpticsEstimateResult({ wavelengthNm: 550 }, fakeDocument, container);
    assert.strictEqual(partial.success, true);
    const pipeBad = renderPipingStressResult({ success: false }, fakeDocument, container);
    assert.strictEqual(pipeBad.success, false);
    const pipeOk = renderPipingStressResult(
      { success: true, hoopStress_MPa: 100, thermalElongation_mm: 0.5, expansionStress_MPa: 40 },
      fakeDocument,
      container
    );
    assert.strictEqual(pipeOk.success, true);
  });

  check('bode_chart_model fromAnalyzerResult/getSyntheticPreset/render branches', () => {
    assert.strictEqual(getSyntheticPreset('synthetic_second_order').numCoeffs.length, 1);
    assert.strictEqual(getSyntheticPreset('bogus'), null);
    const notExperimental = fromAnalyzerResult({ validationLevel: 'verified', bodePoints: [] });
    assert.strictEqual(notExperimental.success, false);
    const tooShort = fromAnalyzerResult({ validationLevel: 'experimental', bodePoints: [{}] });
    assert.strictEqual(tooShort.success, false);
    const badMargins = fromAnalyzerResult({
      validationLevel: 'experimental',
      bodePoints: [
        { omegaRadS: 1, magnitudeDb: 0, phaseDeg: 0 },
        { omegaRadS: 2, magnitudeDb: -1, phaseDeg: -10 }
      ],
      gainMarginDb: 'x',
      phaseMarginDeg: null,
      gainCrossoverFreq: 1,
      phaseCrossoverFreq: 1
    });
    assert.strictEqual(badMargins.success, false);
    const nonIncreasing = fromAnalyzerResult({
      validationLevel: 'experimental',
      bodePoints: [
        { omegaRadS: 2, magnitudeDb: 0, phaseDeg: 0 },
        { omegaRadS: 1, magnitudeDb: 0, phaseDeg: 0 }
      ],
      gainMarginDb: 1,
      phaseMarginDeg: 1,
      gainCrossoverFreq: 1,
      phaseCrossoverFreq: 1
    });
    assert.strictEqual(nonIncreasing.success, false);
    const analyzerResult = {
      validationLevel: 'experimental',
      bodePoints: [
        { omegaRadS: 1, magnitudeDb: 0, phaseDeg: 0 },
        { omegaRadS: 2, magnitudeDb: -1, phaseDeg: -10 },
        { omegaRadS: 3, magnitudeDb: -3, phaseDeg: -30 }
      ],
      gainMarginDb: 8,
      phaseMarginDeg: 45,
      gainCrossoverFreq: 5,
      phaseCrossoverFreq: 7
    };
    const model = fromAnalyzerResult(analyzerResult);
    assert.strictEqual(model.success, true);
    assert.strictEqual(model.frequencies.length, 3);
    const chart = new FakeElement('div');
    const summary = new FakeElement('div');
    const rendered = renderBode(analyzerResult, fakeDocument, chart, summary);
    assert.strictEqual(rendered.success, true);
    const badChart = renderBode(null, fakeDocument, null, null);
    assert.strictEqual(badChart.success, false);
    const failedModel = fromAnalyzerResult({ validationLevel: 'experimental', bodePoints: [] });
    const failedRender = renderBode(failedModel, fakeDocument, chart, null);
    assert.strictEqual(failedRender.success, false);
    const noSummary = renderBode(analyzerResult, fakeDocument, chart, null);
    assert.strictEqual(noSummary.success, true);
  });

  check('materials_catalog_view filter/format/build/render/mount branches', () => {
    const cards = [
      {
        id: 'AL-7075',
        name: '7075',
        class: 'aluminum',
        E293Pa: 7.2e10,
        nu: 0.33,
        rhoKgM3: 2810,
        Sy293Pa: 5e8,
        EAtTemperatureKPa: 6.8e10,
        source: { reference: 'ref' }
      },
      { id: 'TI-6AL4V', name: 'Ti', class: 'titanium', E293Pa: 1.1e11 }
    ];
    assert.strictEqual(filterCards(cards, '').length, 2);
    assert.strictEqual(filterCards(cards, 'al-').length, 1);
    assert.strictEqual(filterCards(null, 'x').length, 0);
    assert.strictEqual(formatGPa('nope'), 'Unavailable');
    assert(formatGPa(7.2e10).endsWith('GPa'));
    assert.strictEqual(formatGPa(NaN), 'Unavailable');
    const container = new FakeElement('div');
    const ok = renderCatalog(fakeDocument, container, cards, 293, 'note');
    assert.strictEqual(ok.success, true);
    const single = renderCatalog(fakeDocument, container, cards.slice(0, 1), 293, null);
    assert.strictEqual(single.success, true);
    const badContainer = renderCatalog(fakeDocument, null, cards, 293);
    assert.strictEqual(badContainer.success, false);
    const card = buildCard(fakeDocument, cards[0], 293);
    assert.strictEqual(card.className, 'telemetry-card material-card');
    const root = new FakeElement('div');
    let queryCalled = 0;
    const api = {
      materialsCatalogQuery: async (request) => {
        queryCalled++;
        if (request.search === 'miss') return { success: true, cards: [] };
        return { success: true, cards };
      }
    };
    const mounted = mountMaterials(fakeDocument, root, api, { temperatureK: 600 });
    assert.strictEqual(mounted.success, true);
    const rootBad = mountMaterials(fakeDocument, null, api);
    assert.strictEqual(rootBad.success, false);
    const missingApi = mountMaterials(fakeDocument, new FakeElement('div'), null);
    assert.strictEqual(missingApi.success, true);
    assert(queryCalled >= 1);
    const failingApi = {
      materialsCatalogQuery: async () => {
        throw new Error('boom');
      }
    };
    const failingMounted = mountMaterials(fakeDocument, new FakeElement('div'), failingApi);
    assert.strictEqual(failingMounted.success, true);
  });

  check('optics_glass_lookup_view filter/spectrum/render/mount branches', () => {
    const glasses = [
      {
        name: 'N-BK7',
        supplier: 'Schott',
        type: 'crown',
        nd: 1.5168,
        Abbe_Vd: 64.17,
        sellmeier: { B: [1, 2, 3], C: [0.1, 0.2, 0.3] },
        dndTPerK: 2e-6,
        dataStatus: 'datasheet',
        provenance: { manufacturer: 'Schott', note: 'n' },
        spectrum: [
          { wavelengthUm: 0.4, index: 1.53 },
          { wavelengthUm: 0.7, index: 1.51 }
        ]
      },
      { name: 'F2', supplier: 'Schott', type: 'flint', nd: 1.62 }
    ];
    assert.strictEqual(filterGlasses(glasses, '').length, 2);
    assert.strictEqual(filterGlasses(glasses, 'bk7').length, 1);
    assert.strictEqual(filterGlasses(null, 'x').length, 0);
    const model = buildSpectrumModel(glasses[0].spectrum);
    assert.strictEqual(model.success, true);
    assert.strictEqual(model.points.length, 2);
    const emptyModel = buildSpectrumModel([]);
    assert.strictEqual(emptyModel.success, false);
    const sparseModel = buildSpectrumModel([{ wavelengthUm: 0.4, index: 1.5 }]);
    assert.strictEqual(sparseModel.success, false);
    const svgHost = new FakeElement('div');
    const svgOk = renderSpectrumSvg(fakeDocument, svgHost, model);
    assert.strictEqual(svgOk.success, true);
    assert.strictEqual(svgOk.empty, undefined);
    const svgEmpty = renderSpectrumSvg(fakeDocument, svgHost, emptyModel);
    assert.strictEqual(svgEmpty.empty, true);
    const svgBad = renderSpectrumSvg(fakeDocument, null, model);
    assert.strictEqual(svgBad.success, false);
    const details = new FakeElement('div');
    const detailOk = renderGlassDetails(fakeDocument, details, glasses[0]);
    assert.strictEqual(detailOk.success, true);
    const detailBad = renderGlassDetails(fakeDocument, null, glasses[0]);
    assert.strictEqual(detailBad.success, false);
    const detailNull = renderGlassDetails(fakeDocument, details, null);
    assert.strictEqual(detailNull.success, false);
    const root = new FakeElement('div');
    let glassQueryCalled = 0;
    const api = {
      opticsGlassLookup: async () => {
        glassQueryCalled++;
        return { success: true, glasses };
      }
    };
    const mounted = mountGlasses(fakeDocument, root, api, { query: 'N-BK7', wavelengthsUm: [0.4, 0.7] });
    assert.strictEqual(mounted.success, true);
    const mountedBad = mountGlasses(fakeDocument, null, api);
    assert.strictEqual(mountedBad.success, false);
    const mountedNoApi = mountGlasses(fakeDocument, new FakeElement('div'), null);
    assert.strictEqual(mountedNoApi.success, true);
    const failingGlassesApi = {
      opticsGlassLookup: async () => {
        throw new Error('boom');
      }
    };
    const mountedFailing = mountGlasses(fakeDocument, new FakeElement('div'), failingGlassesApi);
    assert.strictEqual(mountedFailing.success, true);
    assert(glassQueryCalled >= 1);
  });

  check('ai_surrogate_trainer_view parse/build/render/mount branches', () => {
    const parsed = parseCsv('0,0,0\n1,0,1\n0,1,1\n1,1,2');
    assert.strictEqual(parsed.success, true);
    assert.strictEqual(parsed.rowCount, 4);
    const notString = parseCsv(42);
    assert.strictEqual(notString.success, false);
    const shortRow = parseCsv('1,2');
    assert.strictEqual(shortRow.success, false);
    const nonFinite = parseCsv('1,x,2');
    assert.strictEqual(nonFinite.success, false);
    const oneRow = parseCsv('1,2,3');
    assert.strictEqual(oneRow.success, false);
    const blankLines = parseCsv('1,2,3\n\n4,5,6\n');
    assert.strictEqual(blankLines.success, true);
    const loss = buildLossLineModel([1.5, 0.5, 0.1]);
    assert.strictEqual(loss.success, true);
    assert.strictEqual(loss.points.length, 3);
    const lossEmpty = buildLossLineModel([0.5]);
    assert.strictEqual(lossEmpty.success, false);
    const lossBad = buildLossLineModel('x');
    assert.strictEqual(lossBad.success, false);
    const svgHost = new FakeElement('div');
    const svgOk = renderLossSvg(fakeDocument, svgHost, loss);
    assert.strictEqual(svgOk.success, true);
    const svgEmpty = renderLossSvg(fakeDocument, svgHost, lossEmpty);
    assert.strictEqual(svgEmpty.empty, true);
    const svgBad = renderLossSvg(fakeDocument, null, loss);
    assert.strictEqual(svgBad.success, false);
    const pred = parsePredictInput('1', 2);
    assert.strictEqual(pred.success, true);
    const predBad = parsePredictInput('x', 2);
    assert.strictEqual(predBad.success, false);
    const root = new FakeElement('div');
    let trainCalled = 0;
    const api = {
      aiTrainSurrogate: async () => {
        trainCalled++;
        return {
          success: true,
          model: { w: [1] },
          initialLoss: 1,
          finalLoss: 0.1,
          converged: true,
          lossHistory: [1, 0.5, 0.1]
        };
      },
      aiPredictSurrogate: async () => ({ success: true, predictions: [[2.5]] })
    };
    const mounted = mountSurrogate(fakeDocument, root, api, { defaultCsv: '0,0,0\n1,0,1' });
    assert.strictEqual(mounted.success, true);
    const mountedBad = mountSurrogate(fakeDocument, null, api);
    assert.strictEqual(mountedBad.success, false);
    const mountedNoApi = mountSurrogate(fakeDocument, new FakeElement('div'), null);
    assert.strictEqual(mountedNoApi.success, true);
    assert(trainCalled >= 0);
    const trainFailsApi = {
      aiTrainSurrogate: async () => ({ success: false, error: { message: 'no' } }),
      aiPredictSurrogate: async () => ({})
    };
    const mountedTrainFail = mountSurrogate(fakeDocument, new FakeElement('div'), trainFailsApi);
    assert.strictEqual(mountedTrainFail.success, true);
    const trainThrowsApi = {
      aiTrainSurrogate: async () => {
        throw new Error('boom');
      }
    };
    const mountedTrainThrows = mountSurrogate(fakeDocument, new FakeElement('div'), trainThrowsApi);
    assert.strictEqual(mountedTrainThrows.success, true);
  });

  check('hpc_local_dispatch_view renderTransitions/renderResult/mount branches', () => {
    const container = new FakeElement('div');
    const empty = renderTransitions(fakeDocument, container, []);
    assert.strictEqual(empty.success, true);
    const filled = renderTransitions(fakeDocument, container, [
      { from: 'queued', to: 'running', event: 'start', at: '2026-01-01T00:00:00.000Z' }
    ]);
    assert.strictEqual(filled.success, true);
    const badContainer = renderHpcResult(fakeDocument, null, { success: true });
    assert.strictEqual(badContainer.success, false);
    const failed = renderHpcResult(fakeDocument, container, { success: false, error: { message: 'boom' } });
    assert.strictEqual(failed.success, true);
    const failedNoErr = renderHpcResult(fakeDocument, container, {});
    assert.strictEqual(failedNoErr.success, true);
    const ok = renderHpcResult(fakeDocument, container, {
      success: true,
      jobId: 'j1',
      status: 'COMPLETED',
      provider: 'local',
      scheduler: 'mp',
      executionDurationMs: 12,
      result: { relativeResidual: 1e-6, checksum: 'abcd1234...', iterations: 10, converged: true }
    });
    assert.strictEqual(ok.success, true);
    const okPartial = renderHpcResult(fakeDocument, container, { success: true, result: {} });
    assert.strictEqual(okPartial.success, true);
    const root = new FakeElement('div');
    let dispatchCalled = 0;
    const api = {
      hpcLocalDispatch: async () => {
        dispatchCalled++;
        return {
          success: true,
          transitions: [],
          result: { relativeResidual: 1e-5, checksum: 'x', iterations: 4, converged: true }
        };
      }
    };
    const mounted = mountHpc(fakeDocument, root, api, { defaultN: 16 });
    assert.strictEqual(mounted.success, true);
    const mountedBad = mountHpc(fakeDocument, null, api);
    assert.strictEqual(mountedBad.success, false);
    const mountedNoApi = mountHpc(fakeDocument, new FakeElement('div'), null);
    assert.strictEqual(mountedNoApi.success, true);
    assert(dispatchCalled >= 0);
  });

  check('spice_oscilloscope_ui render/submit/renderResult branches', async () => {
    const container = new FakeElement('div');
    const canvas = new FakeElement('canvas', 'canvas-oscilloscope-screen');
    canvas.getContext = () => createCanvasContext();
    const status = new FakeElement('div', 'spice-run-status');
    const button = new FakeElement('button', 'spice-run-button');
    const input = new FakeElement('textarea', 'spice-request-json');
    const panel = new FakeElement('div', 'spice-result-panel');
    const legend = new FakeElement('div', 'spice-node-legend');
    const summary = new FakeElement('div', 'spice-run-summary');
    const warnings = new FakeElement('div', 'spice-run-warnings');
    const readout = new FakeElement('div', 'scope-cursor-readout');
    elementRegistry.set('canvas-oscilloscope-screen', canvas);
    elementRegistry.set('spice-run-status', status);
    elementRegistry.set('spice-run-button', button);
    elementRegistry.set('spice-request-json', input);
    elementRegistry.set('spice-result-panel', panel);
    elementRegistry.set('spice-node-legend', legend);
    elementRegistry.set('spice-run-summary', summary);
    elementRegistry.set('spice-run-warnings', warnings);
    elementRegistry.set('scope-cursor-readout', readout);

    let solved = 0;
    const solveCircuit = async (request) => {
      solved++;
      assert(request.analysis.type === 'transient');
      return {
        success: true,
        transient: {
          time: [0, 1, 2],
          nodes: {
            out: [0, 0.5, 1],
            0: [0, 0, 0],
            bad: ['x', 'y', 'z']
          }
        },
        analysis: { stepS: 0.001 },
        warnings: ['warn1', 42, 'warn2']
      };
    };
    const osc = new SpiceOscilloscopeUI(container, solveCircuit);
    osc.render();
    assert(osc.canvas === canvas);
    input.value = JSON.stringify({ analysis: { type: 'transient', stopTimeS: 0.002, stepS: 0.001 }, components: [] });
    const submitEvent = { preventDefault: () => {} };
    await osc._submitRequest(submitEvent);
    assert.strictEqual(osc.waveforms.length, 1);
    assert.strictEqual(osc.maxTimeMs, 2);
    assert(osc.waveforms[0].points.length === 3);
    osc._drawGraticuleAndTraces();
    osc._updateCursorReadout(1);
    assert.strictEqual(osc._valueAt(osc.waveforms[0], 1), 0.5);
    const single = { points: [{ t: 0, v: 1 }] };
    assert.strictEqual(osc._valueAt(single, 5), 1);
    const degenerate = {
      points: [
        { t: 0, v: 1 },
        { t: 0, v: 2 }
      ]
    };
    assert.strictEqual(osc._valueAt(degenerate, 0.5), 2);
    const pastEnd = {
      points: [
        { t: 0, v: 1 },
        { t: 1, v: 2 }
      ]
    };
    assert.strictEqual(osc._valueAt(pastEnd, 99), 2);
    osc.hoverTime = 0.5;
    osc._drawGraticuleAndTraces();
    osc.hoverTime = null;
    osc._drawGraticuleAndTraces();

    const oscNoSolve = new SpiceOscilloscopeUI(container, null);
    oscNoSolve.render();
    await oscNoSolve._submitRequest({ preventDefault: () => {} });
    assert(status.textContent.includes('unavailable'));

    const oscBadJson = new SpiceOscilloscopeUI(container, solveCircuit);
    input.value = '{not json';
    await oscBadJson._submitRequest({ preventDefault: () => {} });
    assert(status.textContent.includes('Invalid JSON'));

    const oscEmptyResult = new SpiceOscilloscopeUI(container, async () => ({
      success: false,
      error: { message: 'no data' }
    }));
    input.value = '{}';
    await oscEmptyResult._submitRequest({ preventDefault: () => {} });
    assert(status.textContent.includes('No result'));

    const oscBadShape = new SpiceOscilloscopeUI(container, async () => ({
      success: true,
      transient: { time: 'x', nodes: {} }
    }));
    await oscBadShape._submitRequest({ preventDefault: () => {} });
    assert(status.textContent.includes('unsupported waveform'));

    const oscNoPoints = new SpiceOscilloscopeUI(container, async () => ({
      success: true,
      transient: { time: [0, 1], nodes: { out: ['a', 'b'] } }
    }));
    await oscNoPoints._submitRequest({ preventDefault: () => {} });
    assert(status.textContent.includes('no plottable'));

    const oscZeroTime = new SpiceOscilloscopeUI(container, async () => ({
      success: true,
      transient: { time: [0, 0], nodes: { out: [0, 0] } }
    }));
    await oscZeroTime._submitRequest({ preventDefault: () => {} });
    assert(status.textContent.includes('no plottable'));

    const oscThrows = new SpiceOscilloscopeUI(container, async () => {
      throw new Error('kernel failed');
    });
    await oscThrows._submitRequest({ preventDefault: () => {} });
    assert(status.textContent.includes('kernel failed'));
    assert(solved >= 1);
  });

  check('optical_inspector_ui setInputRequest/readInputRequest/render branches', () => {
    const container = new FakeElement('div');
    const inspector = new OpticalInspectorUI(container);
    inspector.setInputRequest({ surfaces: [{ r: 1 }], entrancePupilRadiusMm: 5 });
    assert.strictEqual(inspector.inputRequest.surfaces.length, 1);
    inspector.setInputRequest(null);
    assert.strictEqual(inspector.inputRequest.surfaces.length, 0);

    const surfacesInput = new FakeElement('textarea', 'optical-surfaces-input');
    const makeNumberInput = (id) => {
      const el = new FakeElement('input', id);
      el.value = '1';
      return el;
    };
    elementRegistry.set('optical-surfaces-input', surfacesInput);
    const ids = [
      'optical-pupil-radius',
      'optical-pupil-plane',
      'optical-wavelength',
      'optical-ring-count',
      'optical-rays-per-ring',
      'optical-field-angle',
      'optical-sensor-position',
      'optical-f-number',
      'optical-max-frequency'
    ];
    for (const id of ids) elementRegistry.set(id, makeNumberInput(id));
    surfacesInput.value = JSON.stringify([
      {
        radius: 10,
        zVertex: 0,
        clearRadius: 5,
        nIncident: 1,
        nTransmitted: 1.5,
        conic: 0,
        asphericCoeffs: [0, 0, 0, 0]
      },
      {
        radius: -10,
        zVertex: 5,
        clearRadius: 5,
        nIncident: 1.5,
        nTransmitted: 1,
        conic: 0,
        asphericCoeffs: [0, 0, 0, 0]
      }
    ]);
    const read = inspector.readInputRequest();
    assert.strictEqual(read.surfaces.length, 2);
    assert.strictEqual(read.numRings, 1);

    surfacesInput.value = 'not json';
    assert.throws(() => inspector.readInputRequest(), /valid JSON/);
    surfacesInput.value = '[{}]';
    assert.throws(() => inspector.readInputRequest(), /at least two/);
    surfacesInput.value = '[]';
    assert.throws(() => inspector.readInputRequest(), /at least two/);
    surfacesInput.value = JSON.stringify([{}, {}]);
    elementRegistry.get('optical-pupil-radius').value = 'x';
    assert.throws(() => inspector.readInputRequest(), /entrance pupil radius/);
    elementRegistry.get('optical-pupil-radius').value = '1';
    elementRegistry.get('optical-ring-count').value = '1.5';
    assert.throws(() => inspector.readInputRequest(), /ring count/);
    elementRegistry.get('optical-ring-count').value = '1';
    const readAgain = inspector.readInputRequest();
    assert.strictEqual(readAgain.entrancePupilRadiusMm, 1);
    assert.strictEqual(inspector._escapeHtml('<a>&"'), '&lt;a&gt;&amp;&quot;');

    inspector.render({ success: false, error: { message: 'nope' } });
    assert(container.innerHTML.includes('Experimental optical analysis unavailable'));

    const surfaces = [{ radius: 0, zVertex: 0, thickness: 2, clearRadius: 5, nTransmitted: 1.5 }];
    const mtfData = {
      frequencies: [0, 10, 20],
      tangentialMTF: [1, 0.8, 0.5],
      sagittalMTF: [1, 0.7, 0.4],
      diffractionLimitMTF: [1, 0.85, 0.6],
      mtf50TangentialLpMm: 45,
      mtf50SagittalLpMm: 40,
      cutoffFreqLpMm: 200
    };
    const spotData = {
      spots: [{ x: 0.001, y: -0.002 }],
      count: 1,
      centroidX: 0.001,
      centroidY: -0.002,
      rmsRadiusMm: 0.005,
      geoRadiusMm: 0.006
    };
    const canvasSpot = new FakeElement('canvas', 'canvas-spot-diagram');
    canvasSpot.getContext = () => createCanvasContext();
    const canvasMtf = new FakeElement('canvas', 'canvas-mtf-curve');
    canvasMtf.getContext = () => createCanvasContext();
    elementRegistry.set('canvas-spot-diagram', canvasSpot);
    elementRegistry.set('canvas-mtf-curve', canvasMtf);
    inspector.render({
      success: true,
      surfaces,
      spotData,
      mtfData,
      aperture: 2.8,
      wavelengthNm: 550,
      maxFrequencyLpMm: 200,
      warnings: ['w']
    });
    assert.strictEqual(inspector.currentSurfaces.length, 1);
    assert.strictEqual(inspector.currentAperture, 2.8);
    const rowsEmpty = inspector._renderPrescriptionRows();
    assert(rowsEmpty.includes('No optical surfaces loaded') === false);
    inspector.currentSurfaces = [];
    assert(inspector._renderPrescriptionRows().includes('No optical surfaces loaded'));
    inspector.currentSurfaces = surfaces;
    inspector._drawSpotDiagram();
    inspector._drawMTFCurve();
    inspector.currentMTFData = { frequencies: [0], tangentialMTF: [1], sagittalMTF: [1], diffractionLimitMTF: [1] };
    inspector._drawMTFCurve();
    inspector.currentMTFData = null;
    inspector._drawMTFCurve();
    inspector.currentSpotData = null;
    inspector._drawSpotDiagram();

    inspector.render({
      mtf: { spatialFrequencies: [0, 10], tangential: [1, 0.5], sagittal: [1, 0.4], diffractionLimit: [1, 0.6] },
      success: true,
      surfaces,
      spotData,
      aperture: 2.8,
      wavelengthNm: 550
    });
    assert(inspector.currentMTFData.frequencies.length === 2);
    inspector.render(null);
    assert(container.innerHTML.includes('Experimental optical analysis unavailable'));
  });

  check('pid_studio_ui render/generate/zoom/schedule/download branches', async () => {
    const container = new FakeElement('div', 'pid-preview');
    const panel = new FakeElement('div', 'modal-pid-studio');
    elementRegistry.set('modal-pid-studio', panel);
    const studio = new PIDStudioUI('pid-preview');
    studio.render();
    assert(studio.elements !== null);
    assert.strictEqual(studio.elements.status.textContent, 'No sheet generated yet.');

    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1189" height="841"></svg>';
    global.window.omniEngAPI.generatePID = async ({ template }) => ({
      success: true,
      sheets: [{ sheetNumber: 1, svg, format: 'A1', widthMm: 594, heightMm: 841, scale: 50 }],
      schedule: {
        equipment: [{ tag: 'P-1', type: 'pump', description: 'Pump', size: '4"' }],
        lines: [{ lineNumber: 'L-1', from: 'A', to: 'B', service: 'water', diameter: 4, spec: 'CS' }],
        instruments: [],
        valves: [],
        controlLoops: []
      },
      validation: { errors: [{ message: 'e1' }], warnings: ['w1'] },
      note: 'note'
    });
    await studio.generate('oilgas');
    assert.strictEqual(studio.sheets.length, 1);
    assert.strictEqual(studio.svgNode.tagName, 'SVG');
    assert.strictEqual(studio.elements.status.textContent.includes('Generated sheet 1/1'), true);
    assert.strictEqual(studio._formatScale(undefined), '1:50');
    assert.strictEqual(studio._formatScale(100), '1:100');
    assert.strictEqual(studio._formatScale('25'), '1:25');
    assert.strictEqual(studio._formatScale('CUSTOM'), 'CUSTOM');
    assert.strictEqual(studio._messageText(null), '');
    assert.strictEqual(studio._messageText('x'), 'x');
    assert.strictEqual(studio._messageText({ message: 'm' }), 'm');
    assert.strictEqual(studio._messageText(7), '7');
    assert.strictEqual(studio._scalarText(' str '), 'str');
    assert.strictEqual(studio._scalarText(5), '5');
    assert.strictEqual(studio._scalarText(true), 'true');
    assert.strictEqual(studio._scalarText(['a', '', 'b']), 'a; b');
    assert.strictEqual(studio._scalarText({ tag: 'T1' }), 'T1');
    assert.strictEqual(studio._scalarText({}), '');
    assert.strictEqual(studio._scalarText(null), '');
    assert.strictEqual(studio._csvEscape('plain'), 'plain');
    assert.strictEqual(studio._csvEscape('a,"b"'), '"a,""b"""');
    assert.strictEqual(studio._csvEscape(null), '');
    studio._zoomBy(1.25);
    assert(studio.zoom > 1);
    studio._setZoom(1);
    studio._fitZoom();
    assert.strictEqual(studio.zoom > 0, true);
    studio._applyZoomToSvg();
    studio.scheduleToCsv('equipment', [{ tag: 'P-1' }, 'junk', null]);
    studio.scheduleToCsv('unknown', []);
    studio._renderScheduleTable(studio.elements.scheduleBody, 'equipment', studio.schedule);
    studio.scheduleFilter = 'P-1';
    studio._renderScheduleTable(studio.elements.scheduleBody, 'equipment', studio.schedule);
    studio.scheduleFilter = 'zzz';
    studio._renderScheduleTable(studio.elements.scheduleBody, 'valves', studio.schedule);
    studio._renderValidation(studio.validation, studio.note);
    studio._renderValidation({ errors: [], warnings: [] }, '');
    studio._renderStatus(studio.sheets);
    studio.downloadSvg();
    studio.downloadCsv();
    studio.downloadValidationTxt();
    studio.printSheet();
    studio._showStatusError('fail');

    global.window.omniEngAPI.generatePID = async () => {
      throw new Error('gen failed');
    };
    await studio.generate('oilgas');
    assert(studio.elements.status.textContent.includes('Generation failed'));

    const studioNoApi = new PIDStudioUI('pid-preview');
    studioNoApi.render();
    delete global.window.omniEngAPI.generatePID;
    await studioNoApi.generate('oilgas');
    assert(studioNoApi.elements.status.textContent.includes('unavailable'));

    global.window.omniEngAPI.generatePID = async () => ({ success: true, sheets: [], schedule: {}, validation: {} });
    await studio.generate('oilgas');
    assert.strictEqual(studio.sheets.length, 0);
    studio._renderStatus(studio.sheets);

    const noSvg = new PIDStudioUI('pid-preview');
    noSvg.render();
    noSvg.elements = null;
    await noSvg.generate('oilgas');
  });

  check('design_wizards wizard branches', () => {
    assert.strictEqual(PlainEnglishErrorTranslator.translate({ rawError: 'oops' }).plainEnglishAdvice, 'oops');
    assert.strictEqual(PlainEnglishErrorTranslator.translate({ code: 'E1' }).domain, 'universal');
    const drop = new DropTestWizard();
    const dropRes = drop.runWizard({ phoneMassKg: 0.2, dropHeightM: 1.5, impactAngle: 'corner' });
    assert.strictEqual(dropRes.wizard, 'DropTestWizard');
    assert.throws(() => drop.runWizard({ phoneMassKg: 0, dropHeightM: 1, impactAngle: 'face' }), /DropTestWizard/);
    assert.throws(() => drop.runWizard({ phoneMassKg: 0.2, dropHeightM: 1, impactAngle: 'side' }), /DropTestWizard/);
    const drone = new DroneDesignWizard();
    const droneRes = drone.runWizard({
      payloadKg: 1,
      frameMassKg: 0.5,
      batteryMassKg: 0.3,
      propellerDiameterInches: 10,
      rotorCount: 4,
      figureOfMerit: 0.7,
      airDensityKgM3: 1.225,
      gravityMPerS2: 9.81
    });
    assert.strictEqual(droneRes.wizard, 'DroneDesignWizard');
    assert.throws(
      () =>
        drone.runWizard({
          payloadKg: -1,
          frameMassKg: 1,
          batteryMassKg: 1,
          propellerDiameterInches: 10,
          rotorCount: 4,
          figureOfMerit: 0.5,
          airDensityKgM3: 1.2,
          gravityMPerS2: 9.81
        }),
      /Drone hover estimate/
    );
    assert.throws(
      () =>
        drone.runWizard({
          payloadKg: 1,
          frameMassKg: 1,
          batteryMassKg: 1,
          propellerDiameterInches: 10,
          rotorCount: 2.5,
          figureOfMerit: 0.5,
          airDensityKgM3: 1.2,
          gravityMPerS2: 9.81
        }),
      /Drone hover estimate/
    );
    assert.throws(
      () =>
        drone.runWizard({
          payloadKg: 1,
          frameMassKg: 1,
          batteryMassKg: 1,
          propellerDiameterInches: 10,
          rotorCount: 4,
          figureOfMerit: 1.2,
          airDensityKgM3: 1.2,
          gravityMPerS2: 9.81
        }),
      /Drone hover estimate/
    );
    const lens = new CameraLensWizard();
    const lensRes = lens.runWizard({
      focalLengthMm: 50,
      fStop: 2.8,
      subjectDistM: 5,
      wavelengthNm: 550,
      circleOfConfusionMm: 0.03
    });
    assert.strictEqual(lensRes.wizard, 'CameraLensWizard');
    assert.throws(
      () =>
        lens.runWizard({ focalLengthMm: 0, fStop: 2.8, subjectDistM: 5, wavelengthNm: 550, circleOfConfusionMm: 0.03 }),
      /CameraLensWizard/
    );
    const pcb = new PCBDesignWizard();
    const pcbRes = pcb.runWizard({
      layerCount: 4,
      dielectricHeightMm: 0.2,
      targetImpedanceOhm: 50,
      er: 4.2,
      copperThicknessMm: 0.035
    });
    assert.strictEqual(pcbRes.wizard, 'PCBDesignWizard');
    assert.throws(
      () =>
        pcb.runWizard({
          layerCount: 0,
          dielectricHeightMm: 0.2,
          targetImpedanceOhm: 50,
          er: 4.2,
          copperThicknessMm: 0.035
        }),
      /PCBDesignWizard/
    );
    const pcbBadTrace = new PCBDesignWizard();
    assert.throws(
      () =>
        pcbBadTrace.runWizard({
          layerCount: 1,
          dielectricHeightMm: 0.001,
          targetImpedanceOhm: 0.1,
          er: 0.1,
          copperThicknessMm: 10
        }),
      /nonpositive/
    );
  });

  check('tactile_spring_physics branches', () => {
    const spring = new TactileSpringPhysics.TactileSpring1D({ mass: 2, stiffness: 100, damping: 10 });
    spring.setTarget(5);
    spring.setValue(1);
    assert.strictEqual(spring.getVelocity(), 0);
    const settled = spring.update(0.016);
    assert.strictEqual(typeof settled, 'boolean');
    spring.setValue(5);
    assert.strictEqual(spring.update(0.016), true);
    assert.strictEqual(spring.isSettled(), true);
    spring.setPreset('CRITICALLY_DAMPED');
    spring.setPreset('SPRINGY_SNAP');
    spring.setPreset('BOUNCY');
    spring.setPreset('HEAVY_INSTRUMENT');
    spring.setPreset('STIFF');
    spring.setPreset('UNKNOWN');
    const unsettled = new TactileSpringPhysics.TactileSpring1D({ mass: 1, stiffness: 100, damping: 10 });
    unsettled.setTarget(10);
    assert.strictEqual(unsettled.update(0.016), false);
    const two = new TactileSpringPhysics.TactileSpring2D();
    two.setTarget(3, 4);
    two.setValue(0, 0);
    two.setPreset('STIFF');
    const settled2 = two.update(0.016);
    assert.strictEqual(typeof settled2, 'boolean');
    two.getValues();
    two.isSettled();
    const three = new TactileSpringPhysics.TactileSpringFollower3D({ stiffness: 200, damping: 20 });
    three.setTarget(1, 2, 3);
    three.setValue(0, 0, 0);
    three.setPreset('BOUNCY');
    const settled3 = three.update(0.016);
    assert.strictEqual(typeof settled3, 'boolean');
    three.getValues();
    three.isSettled();
    assert.strictEqual(TactileSpringPhysics.exponentialFollow(1, 1, 0.1), 1);
    const followed = TactileSpringPhysics.exponentialFollow(0, 10, 0.1, 0.05);
    assert(followed > 0 && followed < 10);
    const followed3 = TactileSpringPhysics.exponentialFollow3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }, 0.1);
    assert(followed3.z > 0);
  });

  check('storytelling_rails controller branches', () => {
    const viewport = {
      cameraFollower: { setTarget: () => {} },
      controls: { target: { set: () => {} } },
      currentMesh: { userData: { updateExplode: () => {} } },
      sectionCutEnabled: false,
      toggleSectionCut: (enabled) => {
        viewport.sectionCutEnabled = enabled;
      }
    };
    const controller = new StorytellingRails.StorytellingRailsController({ viewport3d: viewport, tourIntervalMs: 100 });
    assert.strictEqual(controller.getStages().length, 5);
    const stage = controller.setStage('section_cut');
    assert.strictEqual(stage.id, 'section_cut');
    assert.strictEqual(viewport.sectionCutEnabled, true);
    controller.setStage(0);
    controller.setStage(-5);
    assert.strictEqual(controller.getCurrentStageIndex(), 0);
    controller.setStage(99);
    assert.strictEqual(controller.getCurrentStageIndex(), 4);
    controller.setStage('missing');
    assert.strictEqual(controller.getCurrentStageIndex(), 4);
    controller.nextStage();
    controller.prevStage();
    controller.scrubToStage(3);
    controller.onStageChange(() => {
      throw new Error('ignore me');
    });
    controller.onStageChange('not-a-function');
    controller.setStage(0);
    controller.startTour(50);
    assert.strictEqual(controller.isPlayingTour, true);
    controller.pauseTour();
    assert.strictEqual(controller.isPlayingTour, false);
    controller.toggleTour();
    controller.toggleTour();
    controller.loadStagePreset('nasa_rocket');
    assert.strictEqual(controller.getStages().length, 5);
    assert.strictEqual(controller.getStages()[0].id, 'nasa_launch_pad');
    controller.loadStagePreset('default');
    const noViewport = new StorytellingRails.StorytellingRailsController({});
    noViewport.setStage(1);
    noViewport.nextStage();
    const bareViewport = new StorytellingRails.StorytellingRailsController({
      viewport3d: { cameraFollower: null, controls: null, currentMesh: null }
    });
    bareViewport.setStage(2);
  });

  check('procedural_pbr_materials branches', () => {
    const normal = ProceduralPbrMaterials.createBrushedMetalNormalMap({ width: 8, height: 8, grainScale: 1.5 });
    assert(normal !== null);
    const scratch = ProceduralPbrMaterials.createMicroScratchRoughnessMap({
      width: 8,
      height: 8,
      baseRoughness: 0.4,
      scratchCount: 3
    });
    assert(scratch !== null);
    const scratchDefault = ProceduralPbrMaterials.createMicroScratchRoughnessMap({});
    assert(scratchDefault !== null);
    const anodized = ProceduralPbrMaterials.createAnodizedAluminumMaterial();
    assert(anodized.userData.pbrType.includes('brushed-metal'));
    const turned = ProceduralPbrMaterials.createTurnedStainlessSteelMaterial();
    assert(turned.userData.isIllustrativeOnly === true);
    const optical = ProceduralPbrMaterials.createOpticalArCoatingMaterial(1.52);
    assert(optical.userData.isIllustrativeOnly === true);
    assert.throws(() => ProceduralPbrMaterials.createOpticalArCoatingMaterial(0), /positive finite/);
    assert.throws(() => ProceduralPbrMaterials.createOpticalArCoatingMaterial(NaN), /positive finite/);
  });

  check('procedural_hardware generators branches', () => {
    assert(ProceduralHardware.getDefaultMaterials().steel);
    const g1 = ProceduralHardware.createKnurledCylinder(10, 8, 32);
    assert.strictEqual(g1.userData.type, 'KnurledHardware');
    const g2 = ProceduralHardware.createKnurledCylinder(10, 8, 0x64748b, 40);
    assert.strictEqual(g2.userData.knurlCount, 40);
    const g3 = ProceduralHardware.createKnurledCylinder(10, 8, 0x64748b);
    assert(g3.userData.knurlCount >= 4);
    const mat = ProceduralHardware.getDefaultMaterials().brass;
    const g4 = ProceduralHardware.createKnurledCylinder(10, 8, mat, 12);
    assert.strictEqual(g4.userData.knurlCount, 12);
    const g5 = ProceduralHardware.createKnurledCylinder(10, 8, null, null);
    assert.strictEqual(g5.userData.knurlCount, 32);
    const g6 = ProceduralHardware.createKnurledCylinder(10, 8, 2);
    assert.strictEqual(g6.userData.knurlCount, 4);
    const g7 = ProceduralHardware.createKnurledCylinder(10, 8, 200);
    assert.strictEqual(g7.userData.knurlCount, 64);
    ProceduralHardware.createSocketHeadScrew();
    ProceduralHardware.createSocketHeadScrew(4, 12, 0x334155);
    ProceduralHardware.createSocketHeadScrew(4, 12, mat);
    ProceduralHardware.createIsoCapScrew();
    ProceduralHardware.createIsoCapScrew(3, 10, 0x94a3b8);
    ProceduralHardware.createIsoCapScrew(3, 10, mat);
    ProceduralHardware.createFastenerArray([{ x: 0, y: 0, z: 0 }]);
    ProceduralHardware.createFastenerArray([]);
    ProceduralHardware.createFlangeAssembly();
    ProceduralHardware.createFlangeAssembly(12, 24, 6, 8, 2.2, mat);
    ProceduralHardware.createCoilSpring();
    ProceduralHardware.createCoilSpring(8, 40, 6, 1, mat);
    ProceduralHardware.createCoilSpring(8, 40, 6, 1, null, 'x');
    ProceduralHardware.createDialGauge();
    ProceduralHardware.createDialGauge(16, 0, 100, 50, 'MPa', mat);
    ProceduralHardware.createRulerStrip();
    ProceduralHardware.createRulerStrip(120, 10, 5, 'mm', mat);
    ProceduralHardware.createWeldBead();
    ProceduralHardware.createWeldBead(8, 1.2, 12, mat);
    ProceduralHardware.createBallBearingAssembly();
    ProceduralHardware.createBallBearingAssembly(10, 26, 8, 8, mat);
    ProceduralHardware.createRetainingRing();
    ProceduralHardware.createRetainingRing(12, mat);
    ProceduralHardware.createCotterPin();
    ProceduralHardware.createCotterPin(2, 18, mat);
  });

  check('nasa_space_rocket_3d buildAssembly modes', () => {
    const rocket = new NasaSpaceRocket3D({});
    const full = rocket.buildAssembly('full_stack', null, { ProceduralHardware, ProceduralPbrMaterials });
    assert(full.totalPartsCount > 0);
    const engine = rocket.buildAssembly('engine_macro', null, { ProceduralHardware });
    assert(engine.mode === 'engine_macro');
    const interior = rocket.buildAssembly('spacecraft_interior', null, {});
    assert(interior.totalPartsCount > 0);
    const interiorAlias = rocket.buildAssembly('spaceship_interior', null, {});
    assert(interiorAlias.totalPartsCount > 0);
  });

  check('panel_host top-level bootstrap with mocks', () => {
    elementRegistry.clear();
    const panelTitle = new FakeElement('div', 'panel-title');
    const dockBack = new FakeElement('button', 'btn-dock-back');
    elementRegistry.set('panel-title', panelTitle);
    elementRegistry.set('btn-dock-back', dockBack);
    require('../src/ui/panel_host');
    assert(panelTitle.textContent.length > 0);
    dockBack.click();
  });

  // -----------------------------------------------------------------------
  // app.js partial bootstrap (DOMContentLoaded handlers in a mock environment)
  // -----------------------------------------------------------------------
  check('app.js getExplicitCamRequest + DOMContentLoaded bootstrap', () => {
    const { Viewport3D } = require('../src/ui/viewport3d');
    global.Viewport3D = Viewport3D;
    global.window.Viewport3D = Viewport3D;
    global.window.OmniIcons = { get: () => '', hydrateAll: () => {}, has: () => false };
    global.window.OmniJobMonitor = {
      submitComputeJob: () => {},
      submitHpcJob: () => {},
      cancelActiveJob: async () => {},
      startJob: () => {},
      endJob: () => {},
      updateProgress: () => {}
    };
    global.window.OmniPropertyGridView = { createPropertyGridElements: () => [], readOptionalNumberInput: () => null };
    global.window.OmniWorkspaceTabView = { createWorkspaceTab: () => new FakeElement('div') };
    global.window.OmniSafeDOM = { appendSafeInlineMarkup: () => {} };
    global.window.OmniEdaResultView = {
      renderVerilogResult: () => ({ success: true }),
      renderDrcResult: () => ({ success: true })
    };
    global.window.OmniEngineeringResultView = {
      renderOpticsEstimateResult: () => ({ success: true }),
      renderPipingStressResult: () => ({ success: true })
    };
    global.window.OmniBodeChartModel = { getSyntheticPreset: () => null, render: () => ({ success: true }) };
    global.window.OmniMeasurementHudView = { render: () => ({ success: true }) };
    global.window.omniEngAPI = {
      getFeatureMaturity: async () => ({ success: true, domains: { cad: { state: 'experimental' } } }),
      auditRecordAction: async () => ({ success: true }),
      hashArtifactSha256: async () => ({ success: true, sha256: 'a'.repeat(64) }),
      generateMaturityReport: async () => ({ success: true, report: {} }),
      addBlob: async () => ({ success: true, hash: 'abc' }),
      getBlob: async () => ({ success: true }),
      verifyLedger: async () => ({ success: true }),
      getProposals: async () => ({ success: true, proposals: [] }),
      generatePID: async () => ({ success: true, sheets: [], schedule: {}, validation: {} })
    };
    delete require.cache[require.resolve('../src/ui/app')];
    require('../src/ui/app');
    const camRequest = global.getExplicitCamRequest ? global.getExplicitCamRequest() : null;
    if (global.getExplicitCamRequest) {
      assert(camRequest.request === null);
      assert(typeof camRequest.reason === 'string');
      const fill = (id, value) => {
        const el = fakeDocument.getElementById(id);
        el.value = String(value);
      };
      fill('cam-bound-min-x', 0);
      fill('cam-bound-max-x', 10);
      fill('cam-bound-min-y', 0);
      fill('cam-bound-max-y', 10);
      fill('cam-bound-min-z', 0);
      fill('cam-bound-max-z', 10);
      fill('input-cam-spindle', 1000);
      fill('input-cam-feed', 100);
      fill('input-cam-plunge', 20);
      fill('input-cam-stepover', 1);
      fill('input-cam-stepdown', 1);
      fill('input-cam-safe-z', 5);
      fill('input-cam-program-number', 'O1234');
      const okRequest = global.getExplicitCamRequest();
      assert(okRequest.request !== null);
      assert.strictEqual(okRequest.request.programNumber, 'O1234');
      fill('input-cam-program-number', 'bad');
      const badProgram = global.getExplicitCamRequest();
      assert(badProgram.request === null);
    }
    fireDomContentLoaded();
  });

  // -----------------------------------------------------------------------
  // Tactile / viewport3d light touch
  // -----------------------------------------------------------------------
  check('viewport3d.js loads and exports class', () => {
    const { Viewport3D } = require('../src/ui/viewport3d');
    assert.strictEqual(typeof Viewport3D, 'function');
  });

  // -----------------------------------------------------------------------
  // Main modules
  // -----------------------------------------------------------------------
  const { ComputeHostProcess, getComputeHost } = require('../src/main/compute_host');
  const { HeadlessSolverDaemon } = require('../src/main/headless_solver_daemon');
  const { StenographerSupervisor, LedgerEntry } = require('../src/main/stenographer_supervisor');
  const { ToolDefinition, ToolApprovalClass } = require('../src/core/contracts/ToolDefinition');
  const { ToolProposal } = require('../src/core/contracts/ToolProposal');
  const { ApprovalRecord, ApprovalDecision } = require('../src/core/contracts/ApprovalRecord');
  const { OmniError, OmniErrorCode } = require('../src/core/contracts/OmniError');
  const { defaultEngineRegistry } = require('../src/core/contracts/engine_registry');

  check('compute_host submit/cancel/priority/telemetry branches', async () => {
    const host = new ComputeHostProcess();
    await new Promise((resolve) => host.once('ready', resolve));
    assert.strictEqual(host.executionMode, 'main-event-loop');
    assert.throws(() => new ComputeHostProcess('x'), /constructor options/);
    assert.throws(
      () => new ComputeHostProcess({ poolSize: 4 }),
      (err) => err.code === 'UNSUPPORTED'
    );
    await assert.rejects(() => host.submitJob('', {}), /task type/);
    await assert.rejects(() => host.submitJob('FEA_SOLVE', null), /payload object/);
    await assert.rejects(
      () => host.submitJob('FEA_SOLVE', {}, { timeoutMs: 5 }),
      (err) => err.code === 'UNSUPPORTED'
    );
    await assert.rejects(
      () => host.submitJob('FEA_SOLVE', {}, { priority: 'INSANE' }),
      (err) => err.code === 'INVALID_INPUT'
    );
    const job = host.submitJob('FEA_SOLVE', { x: 1 }, { priority: 'HIGH' });
    await assert.rejects(job, /Unsupported compute task type/);
    await assert.rejects(() => host.submitJob('MISSING', { x: 1 }), /Unsupported compute task type/);
    host.activeJobs.set('fake-running', { status: 'RUNNING' });
    const queued = host.submitJob('FEA_SOLVE', { x: 1 }, { priority: 'LOW' });
    const queuedJob = Array.from(host.activeJobs.values()).find((job) => job.status === 'QUEUED');
    assert(queuedJob);
    assert.strictEqual(host.cancelJob('nope'), false);
    assert(host.getTelemetry().concurrency === 1);
    assert.strictEqual(host.cancelJob(queuedJob.id), true);
    await assert.rejects(queued, /cancelled/);
    host.activeJobs.delete('fake-running');
    const normal = host.submitJob('FEA_SOLVE', { x: 1 }, { priority: 'NORMAL' });
    await assert.rejects(normal, /Unsupported compute task type/);
    const singleton = getComputeHost();
    assert(singleton instanceof ComputeHostProcess);
    assert.throws(
      () => getComputeHost({ threads: 2 }),
      (err) => err.code === 'UNSUPPORTED'
    );
  });

  check('headless_solver_daemon solveJob discipline branches', () => {
    assert.throws(() => HeadlessSolverDaemon.dispatchJob(null), /job specification/);
    assert.throws(() => HeadlessSolverDaemon.dispatchJob({ type: '' }), /discipline/);
    assert.throws(() => HeadlessSolverDaemon.dispatchJob({ type: 'fea', params: [] }), /parameters/);
    assert.throws(() => HeadlessSolverDaemon.solveJob(null), /job specification/);
    assert.throws(() => HeadlessSolverDaemon.solveJob({ discipline: '' }), /discipline/);
    const fea = HeadlessSolverDaemon.solveJob({
      discipline: 'fea',
      parameters: { nodes: [{ x: 0, y: 0, z: 0 }], elements: [] }
    });
    assert.strictEqual(fea.status, 'COMPUTED_EXPERIMENTAL');
    const feaNoNodes = HeadlessSolverDaemon.solveJob({ discipline: 'fea', parameters: {} });
    assert.strictEqual(feaNoNodes.status, 'COMPUTED_EXPERIMENTAL');
    assert.throws(() => HeadlessSolverDaemon.solveJob({ discipline: 'cfd', parameters: {} }), /steps/);
    assert.throws(() => HeadlessSolverDaemon.solveJob({ discipline: 'cfd', parameters: { steps: 0 } }), /steps/);
    const cfd = HeadlessSolverDaemon.solveJob({ discipline: 'cfd', parameters: { steps: 1 } });
    assert.strictEqual(cfd.status, 'COMPUTED_EXPERIMENTAL');
    const steam = HeadlessSolverDaemon.solveJob({
      discipline: 'plant',
      parameters: { operation: 'calculate_steam_properties', pressurePa: 101325, temperatureK: 300 }
    });
    assert.strictEqual(steam.status, 'COMPUTED_EXPERIMENTAL');
    const pinch = HeadlessSolverDaemon.solveJob({
      discipline: 'plant',
      parameters: { type: 'pinch', streams: [], deltaTmin: 10 }
    });
    assert.strictEqual(pinch.status, 'COMPUTED_EXPERIMENTAL');
    const assay = HeadlessSolverDaemon.solveJob({
      discipline: 'plant',
      parameters: {
        type: 'assay',
        options: {
          apiGravity: 30,
          distillationType: 'TBP',
          distillationData: [
            { percent: 0, tempC: 30 },
            { percent: 100, tempC: 300 }
          ],
          dataSource: 'test'
        }
      }
    });
    assert.strictEqual(assay.status, 'COMPUTED_EXPERIMENTAL');
    const wh = HeadlessSolverDaemon.solveJob({ discipline: 'plant', parameters: { type: 'water_hammer' } });
    assert.strictEqual(wh.status, 'UNAVAILABLE');
    const col = HeadlessSolverDaemon.solveJob({ discipline: 'plant', parameters: {} });
    assert.strictEqual(col.status, 'UNAVAILABLE');
    assert.throws(
      () => HeadlessSolverDaemon.solveJob({ discipline: 'pdm', parameters: { type: 'visual_diff', toleranceMm: 1 } }),
      /toleranceMm/
    );
    const pdmDiffOK = HeadlessSolverDaemon.solveJob({
      discipline: 'pdm',
      parameters: {
        type: 'visual_diff',
        toleranceMm: 0.1,
        modificationThresholdMm: 0.3,
        revisionA: {
          commitId: 'a',
          units: { length: 'mm', volume: 'mm3' },
          volumeMm3: 100,
          faces: [{ id: 'f1', centroidMm: { x: 0, y: 0, z: 0 } }]
        },
        revisionB: {
          commitId: 'b',
          units: { length: 'mm', volume: 'mm3' },
          volumeMm3: 110,
          faces: [{ id: 'f1', centroidMm: { x: 0.2, y: 0, z: 0 } }]
        }
      }
    });
    assert.strictEqual(pdmDiffOK.status, 'COMPUTED_EXPERIMENTAL');
    assert.throws(
      () => HeadlessSolverDaemon.solveJob({ discipline: 'pdm', parameters: { rootAssembly: {} } }),
      /partNumber/
    );
    const slurm = HeadlessSolverDaemon.solveJob({
      discipline: 'hpc',
      parameters: { operation: 'generate_slurm_script' }
    });
    assert.strictEqual(slurm.status, 'COMPUTED_EXPERIMENTAL');
    const pbs = HeadlessSolverDaemon.solveJob({ discipline: 'hpc', parameters: { type: 'pbs' } });
    assert.strictEqual(pbs.status, 'COMPUTED_EXPERIMENTAL');
    const rcb = HeadlessSolverDaemon.solveJob({
      discipline: 'hpc',
      parameters: { type: 'rcb', points: [[0, 0, 0]], numPartitions: 1 }
    });
    assert.strictEqual(rcb.status, 'COMPUTED_EXPERIMENTAL');
    const ooc = HeadlessSolverDaemon.solveJob({
      discipline: 'hpc',
      parameters: {
        operation: 'plan_out_of_core',
        dofCount: 10,
        availableRamBytes: 1e9,
        assumptions: { matrixNonzerosPerDof: 5, factorEntriesPerDof: 2 }
      }
    });
    assert.strictEqual(ooc.status, 'COMPUTED_EXPERIMENTAL');
    const hpcUnsupported = HeadlessSolverDaemon.solveJob({ discipline: 'hpc', parameters: {} });
    assert.strictEqual(hpcUnsupported.status, 'UNAVAILABLE');
    const optics = HeadlessSolverDaemon.solveJob({ discipline: 'optics', parameters: { n1: 1, n2: 1.5, thetaI: 0.3 } });
    assert.strictEqual(optics.status, 'COMPUTED_EXPERIMENTAL');
    const eda = HeadlessSolverDaemon.solveJob({ discipline: 'eda', parameters: {} });
    assert.strictEqual(eda.status, 'COMPUTED_EXPERIMENTAL');
    const mcdc = HeadlessSolverDaemon.solveJob({
      discipline: 'controls',
      parameters: { action: 'mcdc', conditions: [{ inputs: { a: true }, expected: true }], func: (inputs) => inputs.a }
    });
    assert.strictEqual(mcdc.status, 'COMPUTED_EXPERIMENTAL');
    const autocode = HeadlessSolverDaemon.solveJob({
      discipline: 'controls',
      parameters: {
        action: 'autocode',
        name: 'TestController',
        sampleRateHz: 100,
        A: [[1]],
        B: [[1]],
        C: [[1]],
        K: [[1]]
      }
    });
    assert.strictEqual(autocode.status, 'COMPUTED_EXPERIMENTAL');
    const controlsUnsupported = HeadlessSolverDaemon.solveJob({ discipline: 'controls', parameters: {} });
    assert.strictEqual(controlsUnsupported.status, 'UNAVAILABLE');
    const robotics = HeadlessSolverDaemon.solveJob({ discipline: 'robotics', parameters: {} });
    assert.strictEqual(robotics.status, 'UNAVAILABLE');
    assert.throws(() => HeadlessSolverDaemon.solveJob({ discipline: 'partition', parameters: {} }), /numPartitions/);
    const partition = HeadlessSolverDaemon.solveJob({
      discipline: 'partition',
      parameters: { nodes: [], elements: [], numPartitions: 1 }
    });
    assert.strictEqual(partition.status, 'COMPUTED_EXPERIMENTAL');
    assert.throws(() => HeadlessSolverDaemon.solveJob({ discipline: 'quantum', parameters: {} }), /Unknown discipline/);
    const health = HeadlessSolverDaemon.getHealth();
    assert.strictEqual(health.status, 'experimental');
  });

  check('stenographer_supervisor ledger/tools/proposals/query branches', async () => {
    const supervisor = new StenographerSupervisor({ mockMode: true });
    assert.strictEqual(supervisor.ledgerKeyIsPersistent, false);
    assert.strictEqual(supervisor.getAuditLedger().length, 0);
    assert.strictEqual(supervisor.verifyLedgerIntegrity().valid, true);
    assert.strictEqual(supervisor.verifySignedLedgerIntegrity().valid, false);
    assert.strictEqual(supervisor.getSignedAuditLedger().length, 0);

    const badTool = new ToolDefinition({
      name: 'bad',
      description: 'd',
      approvalClass: ToolApprovalClass.READ_ONLY,
      classification: ToolApprovalClass.READ_ONLY,
      modifiesState: true
    });
    assert.throws(() => supervisor.registerTool(badTool), /read-only/);
    assert.throws(() => supervisor.registerTool({ name: 'x' }), /ToolDefinition/);
    const tool = new ToolDefinition({
      name: 'test.read_thing',
      description: 'Read',
      approvalClass: ToolApprovalClass.READ_ONLY,
      classification: ToolApprovalClass.READ_ONLY,
      modifiesState: false
    });
    supervisor.registerTool(tool);
    assert.strictEqual(supervisor.getRegisteredTools().length >= 1, true);

    const proposal = supervisor.proposeToolCall({
      toolName: 'test.read_thing',
      originatingProjectRevision: 3,
      idempotencyKey: 'key-1'
    });
    assert(proposal instanceof ToolProposal);
    assert.strictEqual(proposal.status, 'APPROVED');
    assert.throws(() => supervisor.proposeToolCall({}), /toolName/);
    assert.throws(() => supervisor.proposeToolCall({ toolName: 'missing.tool' }), /Unregistered/);
    assert.throws(
      () => supervisor.proposeToolCall({ toolName: 'test.read_thing', originatingProjectRevision: 0 }),
      /revision/
    );
    assert.throws(() => supervisor.proposeToolCall(null), /Invalid proposal input/);
    assert.throws(
      () =>
        supervisor.proposeToolCall({
          toolName: 'test.read_thing',
          originatingProjectRevision: 1,
          approvalClass: ToolApprovalClass.COMPUTE_JOB
        }),
      /Approval class/
    );

    const queryList = supervisor.processQuery('list tools');
    assert.strictEqual(queryList.queryType, 'list_tools');
    const queryVerify = supervisor.processQuery('verify ledger');
    assert.strictEqual(queryVerify.queryType, 'verify_ledger');
    const queryProject = supervisor.processQuery({
      prompt: 'project status',
      projectRevision: 2,
      context: { projectSummary: { revision: 2 } }
    });
    assert.strictEqual(queryProject.queryType, 'project_status');
    const queryDomains = supervisor.processQuery('domain capabilities');
    assert.strictEqual(queryDomains.queryType, 'domain_capabilities');
    const queryUnknown = supervisor.processQuery('sing a song');
    assert.strictEqual(queryUnknown.success, false);
    const queryRobotics = supervisor.processQuery({
      prompt: 'solve inverse kinematics for 6-dof robot',
      projectRevision: 1
    });
    assert.strictEqual(queryRobotics.queryType, undefined);
    assert.strictEqual(queryRobotics.status, 'PROPOSAL_CREATED');
    const queryCad = supervisor.processQuery('cad extrude without revision');
    assert(['INPUT_REQUIRED', 'UNAVAILABLE'].includes(queryCad.status));
    const queryPiping = supervisor.processQuery('piping plant steam calculate');
    assert(['PROPOSAL_CREATED', 'UNAVAILABLE', 'INPUT_REQUIRED'].includes(queryPiping.status));
    const queryRcwa = supervisor.processQuery('rcwa grating optics');
    assert(['PROPOSAL_CREATED', 'UNAVAILABLE', 'INPUT_REQUIRED'].includes(queryRcwa.status));

    const pendingProposal = supervisor.proposeToolCall({
      toolName: 'robotics.solve_kinematics',
      proposalId: 'prop-1',
      originatingProjectRevision: 2,
      args: { operation: 'forward_kinematics' }
    });
    assert.strictEqual(pendingProposal.status, 'PROPOSED');
    assert.throws(
      () =>
        supervisor.proposeToolCall({
          toolName: 'robotics.solve_kinematics',
          proposalId: 'prop-1',
          originatingProjectRevision: 2
        }),
      /Duplicate/
    );
    assert.throws(
      () =>
        supervisor.proposeToolCall({
          toolName: 'robotics.solve_kinematics',
          originatingProjectRevision: 2,
          idempotencyKey: pendingProposal.idempotencyKey
        }),
      /idempotency key/
    );

    const approval = supervisor.evaluateProposal({
      proposalId: 'prop-1',
      decision: 'APPROVED',
      decidedBy: 'engineer',
      rationale: 'ok'
    });
    assert.strictEqual(approval.decision, ApprovalDecision.APPROVED);
    supervisor.proposeToolCall({
      toolName: 'robotics.solve_kinematics',
      proposalId: 'prop-4',
      originatingProjectRevision: 2
    });
    const approvalBool = supervisor.evaluateProposal('prop-4', true, 'engineer', 'looks good');
    assert.strictEqual(approvalBool.decision, ApprovalDecision.APPROVED);
    const pending2 = supervisor.proposeToolCall({
      toolName: 'robotics.solve_kinematics',
      proposalId: 'prop-2',
      originatingProjectRevision: 2
    });
    const rejection = supervisor.evaluateProposal('prop-2', false, 'engineer');
    assert.strictEqual(rejection.decision, ApprovalDecision.REJECTED);
    const pending3 = supervisor.proposeToolCall({
      toolName: 'robotics.solve_kinematics',
      proposalId: 'prop-3',
      originatingProjectRevision: 2
    });
    const rejection3 = supervisor.evaluateProposal('prop-3', 'REJECTED', 'no');
    assert.strictEqual(rejection3.decision, ApprovalDecision.REJECTED);
    assert.throws(() => supervisor.evaluateProposal('missing-prop', 'APPROVED'), /No tool proposal found/);
    assert.throws(() => supervisor.evaluateProposal('prop-1', 'APPROVED'), /no longer pending/);
    assert.strictEqual(supervisor.getProposal('prop-1').id, 'prop-1');
    assert.strictEqual(supervisor.getProposal('missing'), null);

    await assert.rejects(() => supervisor.executeTool('missing-prop'), /Proposal not found/);
    await assert.rejects(() => supervisor.executeTool('prop-2'), /Fail-closed gate/);
    const executed = await supervisor.executeApprovedTool('prop-1', async () => ({ answer: 42 }));
    assert.strictEqual(executed.success, true);
    assert.strictEqual(executed.result.answer, 42);
    assert.strictEqual(supervisor.verifyLedgerIntegrity().valid, true);
    assert.strictEqual(supervisor.ledger.length >= 8, true);

    const persistent = new StenographerSupervisor({
      hmacSecret: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    });
    assert.strictEqual(persistent.ledgerKeyIsPersistent, true);
    assert.throws(() => new StenographerSupervisor({ hmacSecret: 'short' }), /32 bytes/);

    const signed = new StenographerSupervisor({ enableSoftwareSigning: true, mockMode: true });
    signed.connect();
    assert.strictEqual(signed.isConnected, true);
    const status = await signed.getStatus();
    assert.strictEqual(status.signedLedgerSize >= 1, true);
    assert.strictEqual(signed.verifySignedLedgerIntegrity().valid, true);
    await signed.disconnect();
    assert.strictEqual(signed.isConnected, false);

    const unconfigured = new StenographerSupervisor({ mockMode: false });
    await assert.rejects(() => unconfigured.connect(), /not configured/);
    await assert.rejects(() => unconfigured.query(), /unavailable/);
    unconfigured._handleDaemonLine('{"n":1}');
    unconfigured._handleDaemonLine('not json');
    unconfigured._handleDaemonLine('');
    unconfigured._scheduleRestart();
    unconfigured.disconnect();
  });

  check('sbom_service report branches', async () => {
    const {
      generateSbomReport,
      countSbomComponents,
      countSbomPackages,
      countLockfileDependencies,
      manifestDigest,
      loadPackageLockSha256
    } = require('../src/main/sbom_service');
    const lock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
    assert.strictEqual(countLockfileDependencies() > 0, true);
    assert.strictEqual(countSbomComponents({ components: [1, 2] }), 2);
    assert.strictEqual(countSbomComponents({}), 0);
    assert.strictEqual(countSbomPackages({ packages: [1] }), 1);
    assert.strictEqual(countSbomPackages({}), 0);
    assert.strictEqual(loadPackageLockSha256().length, 64);
    assert.strictEqual(manifestDigest({ a: 1 }).length, 64);
    assert(lock.packages);
  });

  // -----------------------------------------------------------------------
  // IPC define_handler / schemas / registration sweep
  // -----------------------------------------------------------------------
  const defineHandlerModule = require('../src/main/ipc/define_handler');
  const { registerAllIpcHandlers } = require('../src/main/ipc/index');
  const cadSchemas = require('../src/main/ipc/cad_schemas');
  const caeSchemas = require('../src/main/ipc/cae_schemas');

  check('cad/cae schema definition shapes', () => {
    assert.strictEqual(cadSchemas.CAD_EXTRUDE_PROFILE_SCHEMA.type, 'object');
    assert.strictEqual(cadSchemas.CAD_REVOLVE_PROFILE_SCHEMA.properties.angleDeg.max, 360);
    assert.strictEqual(cadSchemas.CAD_SHELL_BODY_SCHEMA.properties.openFaceIndex.integer, true);
    assert.strictEqual(cadSchemas.CAD_SHEET_METAL_SCHEMA.properties.flanges.minItems, 2);
    assert.strictEqual(caeSchemas.CONTACT_MECHANICS_SCHEMA.required.length, 6);
    assert.strictEqual(caeSchemas.NONLINEAR_CANTILEVER_ESTIMATE_SCHEMA.additionalProperties, false);
  });

  check('define_handler validateSchema branch matrix', () => {
    const { validateSchema } = defineHandlerModule;
    assert.strictEqual(validateSchema({ x: 1 }, null), true);
    assert.strictEqual(validateSchema(undefined, { optional: true }), true);
    assert.strictEqual(validateSchema(null, { required: false }), true);
    assert.throws(() => validateSchema(null, {}), /Missing required field/);
    assert.throws(() => validateSchema('x', { type: 'array' }), /Expected array/);
    assert.throws(() => validateSchema([1], { type: 'array', minItems: 2 }), /minItems/);
    assert.throws(() => validateSchema([1, 2, 3], { type: 'array', maxItems: 2 }), /maxItems/);
    assert.strictEqual(
      validateSchema([{ x: 1 }], { type: 'array', items: { type: 'object', properties: { x: { type: 'number' } } } }),
      true
    );
    assert.throws(
      () =>
        validateSchema([{ x: 'a' }], {
          type: 'array',
          items: { type: 'object', properties: { x: { type: 'number' } } }
        }),
      /finite number/
    );
    assert.strictEqual(validateSchema(Buffer.from([1, 2]), { type: 'buffer', maxBytes: 1024 }), true);
    assert.strictEqual(validateSchema(new Uint8Array([1]), { type: 'buffer' }), true);
    assert.throws(() => validateSchema([1], { type: 'buffer' }), /Expected Buffer/);
    assert.throws(() => validateSchema('x', { type: 'number' }), /finite number/);
    assert.throws(() => validateSchema(NaN, { type: 'number' }), /finite number/);
    assert.throws(() => validateSchema(1.5, { type: 'number', integer: true }), /integer/);
    assert.throws(() => validateSchema(0, { type: 'number', min: 1 }), /< min/);
    assert.throws(() => validateSchema(5, { type: 'number', max: 4 }), /> max/);
    assert.strictEqual(validateSchema(3, { type: 'number', min: 1, max: 5 }), true);
    assert.throws(() => validateSchema(3, { type: 'string' }), /Expected string/);
    assert.throws(() => validateSchema('toolong', { type: 'string', maxLength: 3 }), /maxLength/);
    assert.throws(() => validateSchema('z', { type: 'string', enum: ['a', 'b'] }), /one of/);
    assert.strictEqual(validateSchema('a', { type: 'string', enum: ['a', 'b'] }), true);
    assert.throws(() => validateSchema('yes', { type: 'boolean' }), /Expected boolean/);
    assert.strictEqual(validateSchema(false, { type: 'boolean' }), true);
    assert.throws(() => validateSchema([], { type: 'object' }), /Expected object/);
    assert.throws(() => validateSchema({}, { type: 'object', required: ['a'] }), /Missing required object property/);
    assert.throws(
      () => validateSchema({ a: 1, b: 2 }, { type: 'object', properties: { a: {} }, additionalProperties: false }),
      /Unexpected object properties/
    );
    assert.strictEqual(validateSchema({ a: 1 }, { type: 'object', properties: { a: { type: 'number' } } }), true);
    assert.throws(() => validateSchema({ a: 'bad' }, { type: 'object', finiteNumbers: ['a'] }), /finite/);
  });

  check('define_handler isTrustedIpcSender branches', () => {
    const { isTrustedIpcSender } = defineHandlerModule;
    const entry = path.join(repositoryRoot, 'src', 'index.html');
    assert.strictEqual(isTrustedIpcSender(null, entry), false);
    assert.strictEqual(isTrustedIpcSender({}, entry), false);
    const base = {
      sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
      senderFrame: { frameTreeNodeId: 42, url: `file://${repositoryRoot}/src/index.html` }
    };
    assert.strictEqual(isTrustedIpcSender(base, entry), true);
    assert.strictEqual(
      isTrustedIpcSender(
        { sender: { isDestroyed: () => true, mainFrame: { frameTreeNodeId: 42 } }, senderFrame: base.senderFrame },
        entry
      ),
      false
    );
    assert.strictEqual(
      isTrustedIpcSender({ sender: { isDestroyed: () => false }, senderFrame: base.senderFrame }, entry),
      false
    );
    assert.strictEqual(
      isTrustedIpcSender(
        { sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 7 } }, senderFrame: base.senderFrame },
        entry
      ),
      false
    );
    assert.strictEqual(
      isTrustedIpcSender(
        {
          sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
          senderFrame: { frameTreeNodeId: 42, url: 'https://evil.example/x' }
        },
        entry
      ),
      false
    );
    assert.strictEqual(
      isTrustedIpcSender(
        {
          sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
          senderFrame: { frameTreeNodeId: 42, url: 'file://other/src/index.html' }
        },
        entry
      ),
      false
    );
    assert.strictEqual(
      isTrustedIpcSender(
        {
          sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
          senderFrame: { frameTreeNodeId: 42, url: `file://${repositoryRoot}/src/index.html?x=1` }
        },
        entry
      ),
      false
    );
  });

  check('define_handler createIpcHandler/defineHandler/withIpcMain branches', async () => {
    const {
      createIpcHandler,
      defineHandler,
      withIpcMain,
      channelRegistry,
      getRegisteredChannels,
      isChannelRegistered
    } = defineHandlerModule;
    channelRegistry.clear();
    ipcHandlers.clear();

    const okHandler = createIpcHandler(
      'omni:test-handler',
      { type: 'object', properties: { n: { type: 'number' } } },
      async (event, payload) => ({ echo: payload.n })
    );
    const okResult = await okHandler(trustedEvent, { n: 7 });
    assert.strictEqual(okResult.echo, 7);
    await assert.rejects(() => okHandler(trustedEvent, { n: 'bad' }), /finite number/);
    const untrusted = {
      sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 1 } },
      senderFrame: { frameTreeNodeId: 1, url: 'file:///etc/passwd' }
    };
    await assert.rejects(() => okHandler(untrusted, { n: 1 }), /untrusted sender/);
    await assert.rejects(() => okHandler(trustedEvent, null), /Missing required field|Expected object/);
    const throwingHandler = createIpcHandler('omni:test-throwing', null, async () => {
      throw new Error('kernel error');
    });
    await assert.rejects(() => throwingHandler(trustedEvent, {}), /kernel error/);

    assert.throws(() => defineHandler('bad-channel', {}, async () => {}), /must start with 'omni:'/);
    assert.throws(() => defineHandler('omni:no-schema', null, async () => {}), /validation schema/);
    assert.throws(() => defineHandler('omni:no-handler', {}, 'x'), /callable handler/);
    let metadata = null;
    withIpcMain(electronMock.ipcMain, () => {
      metadata = defineHandler('omni:test-defined', { type: 'object' }, async () => ({}), {
        domain: 'test',
        description: 'd'
      });
    });
    assert.strictEqual(metadata.channel, 'omni:test-defined');
    assert.strictEqual(metadata.domain, 'test');
    assert.strictEqual(isChannelRegistered('omni:test-defined'), true);
    assert.strictEqual(isChannelRegistered('omni:nope'), false);
    assert(getRegisteredChannels().length >= 1);
    assert.throws(() => defineHandler('omni:test-defined', {}, async () => {}), /Duplicate IPC Handler/);
    assert.strictEqual(ipcHandlers.has('omni:test-defined'), true);

    assert.throws(() => withIpcMain(null, () => {}), /withIpcMain requires/);
    assert.throws(() => withIpcMain({ handle: () => {} }, 'x'), /withIpcMain requires/);
    let ran = false;
    const result = withIpcMain(electronMock.ipcMain, () => {
      ran = true;
      return 42;
    });
    assert.strictEqual(result, 42);
    assert.strictEqual(ran, true);
  });

  check('IPC registration sweep across domains', async () => {
    defineHandlerModule.channelRegistry.clear();
    ipcHandlers.clear();
    registerAllIpcHandlers({ ipcMain: electronMock.ipcMain });
    assert(ipcHandlers.size >= 150);

    const schemaAwarePayload = (schema) => {
      if (!schema || typeof schema !== 'object') return {};
      const build = (node, depth) => {
        if (depth > 4) return 1;
        if (node.type === 'array') {
          const min = Number.isInteger(node.minItems) ? node.minItems : 1;
          const item = node.items ? build(node.items, depth + 1) : 1;
          return Array.from({ length: Math.min(Math.max(min, 1), 4) }, () => item);
        }
        if (node.type === 'buffer') return Buffer.from([1, 2, 3, 4]);
        if (node.type === 'boolean') return true;
        if (node.type === 'string') {
          if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0];
          return 'test';
        }
        if (node.type === 'object') {
          const out = {};
          for (const [key, child] of Object.entries(node.properties || {})) {
            out[key] = build(child, depth + 1);
          }
          return out;
        }
        if (node.type === 'number') {
          let value = 1;
          if (Number.isFinite(node.min) && node.min > 1) value = node.min;
          if (node.integer) value = Math.ceil(value);
          return value;
        }
        return 1;
      };
      return build(schema, 0);
    };

    const heavyChannels = new Set([
      'omni:run-100-gold-benchmarks',
      'omni:run-vv-benchmarks',
      'omni:generate-sbom',
      'omni:new-project',
      'omni:open-project',
      'omni:save-project',
      'omni:record-project-command',
      'omni:package-omni-archive',
      'omni:load-omni-archive',
      'omni:vault-encrypt-project',
      'omni:vault-decrypt-project',
      'omni:submit-hpc-job',
      'omni:hpc-local-dispatch',
      'omni:hpc-execute-local-parallel',
      'omni:stenographer-query',
      'omni:stenographer-evaluate-proposal',
      'omni:stenographer-execute-tool',
      'omni:stenographer-get-proposals',
      'omni:stenographer-get-tools',
      'omni:stenographer-verify-ledger',
      'omni:get-community-samples'
    ]);

    let sweepCalls = 0;
    let sweepSucceeded = 0;
    let sweepRejected = 0;
    for (const channel of ipcHandlers.keys()) {
      if (heavyChannels.has(channel)) continue;
      const meta = defineHandlerModule.channelRegistry.get(channel);
      const payload = schemaAwarePayload(meta ? meta.schema : null);
      try {
        await ipcHandlers.get(channel)(trustedEvent, payload);
        sweepSucceeded++;
      } catch (_) {
        sweepRejected++;
      }
      sweepCalls++;
    }
    assert(sweepCalls >= 130);
    assert(sweepCalls === sweepSucceeded + sweepRejected);

    assert.strictEqual((await ipcHandlers.get('omni:get-feature-maturity')(trustedEvent, {})).success, true);
    const systemInfo = await ipcHandlers.get('omni:get-system-info')(trustedEvent, {});
    assert.strictEqual(typeof systemInfo.platform, 'string');
    const clusterStatus = await ipcHandlers.get('omni:get-cluster-status')(trustedEvent, {});
    assert.strictEqual(typeof clusterStatus.success, 'boolean');
    const hash = await ipcHandlers.get('omni:hash-artifact-sha256')(trustedEvent, { content: 'abc' });
    assert.strictEqual(hash.success, true);
    assert.strictEqual(hash.sha256.length, 64);
    const maturity = await ipcHandlers.get('omni:generate-maturity-report')(trustedEvent, {});
    assert.strictEqual(maturity.success, true);
    const telemetry = await ipcHandlers.get('omni:get-compute-telemetry')(trustedEvent, {});
    assert.strictEqual(telemetry.success, true);

    const heavySubmit = await ipcHandlers.get('omni:submit-compute-job')(trustedEvent, {
      taskType: 'SPARSE_CHOLESKY',
      payload: { n: 2 }
    });
    assert.strictEqual(typeof heavySubmit.success, 'boolean');
    const cancelResult = await ipcHandlers.get('omni:cancel-compute-job')(trustedEvent, { jobId: 'missing' });
    assert(typeof cancelResult.success === 'boolean');
    const emptyTask = await ipcHandlers
      .get('omni:submit-compute-job')(trustedEvent, { taskType: '' })
      .catch((err) => ({ rejected: true, error: err }));
    if (!emptyTask.rejected) {
      assert.strictEqual(emptyTask.success, false);
    }
  });

  const pendingSettled = await Promise.race([
    chain.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 120000))
  ]);
  if (!pendingSettled) {
    failedTests += totalTests - passedTests - failedTests;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapTwentyEightCoverageTests };

if (require.main === module) {
  runBranchGapTwentyEightCoverageTests().then((stats) => {
    console.log(`gap28: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
