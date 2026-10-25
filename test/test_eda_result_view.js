'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DRCEngine } = require('../src/core/eda/drc_engine');
const { LogicSynthesisEngine } = require('../src/core/eda/logic_synthesis');
const { renderDrcResult, renderVerilogResult } = require('../src/ui/eda_result_view');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = '';
    this.textContent = '';
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

  get allText() {
    return [this.textContent, ...this.children.map((child) => child.allText)].filter(Boolean).join(' ');
  }
}

function runEdaResultViewTests() {
  const fakeDocument = { createElement: (tagName) => new FakeElement(tagName) };
  const verilogContainer = new FakeElement('div');
  const verilogResult = LogicSynthesisEngine.synthesize('module tiny;\nassign y = a & b;\nendmodule');
  assert.strictEqual(renderVerilogResult(verilogResult, fakeDocument, verilogContainer).success, true);
  assert.match(verilogContainer.allText, /Parsed toy gates 1 Gates/);
  assert.match(verilogContainer.allText, /Illustrative area 1\.6 µm²/);
  assert.match(verilogContainer.allText, /Serial gate-delay sum 25 ps/);
  assert.match(verilogContainer.allText, /Maximum frequency Not calculated/);
  assert.match(verilogContainer.allText, /no target library/);

  const hostileValue = '</span><img src=x onerror=alert(1)>';
  const invalidVerilogResult = {
    ...verilogResult,
    gateCount: hostileValue,
    totalArea_um2: Number.POSITIVE_INFINITY,
    serialGateDelayEstimate_ps: null
  };
  const invalidVerilogContainer = new FakeElement('div');
  assert.strictEqual(renderVerilogResult(invalidVerilogResult, fakeDocument, invalidVerilogContainer).success, true);
  assert.match(invalidVerilogContainer.allText, /Parsed toy gates Unavailable/);
  assert.match(invalidVerilogContainer.allText, /Illustrative area Unavailable/);
  assert.doesNotMatch(invalidVerilogContainer.allText, /<img src=x/);

  const drcResult = DRCEngine.runDRC([{ id: 'rect-1', layer: 'M1', x: 0, y: 0, w: 1, h: 1 }], {
    minWidth: 1,
    minSpacing: 1,
    minArea: 1
  });
  const drcContainer = new FakeElement('div');
  assert.strictEqual(renderDrcResult(drcResult, fakeDocument, drcContainer).success, true);
  assert.match(drcContainer.allText, /Caller rectangles checked 1/);
  assert.match(drcContainer.allText, /Rectangle rule flags 0/);
  assert.match(drcContainer.allText, /No violations were flagged/);
  assert.match(drcContainer.allText, /no process-specific rule deck/);

  const malformedDrcContainer = new FakeElement('div');
  assert.strictEqual(
    renderDrcResult(
      { success: true, totalShapesChecked: hostileValue, violationCount: Number.NaN, clean: 'yes' },
      fakeDocument,
      malformedDrcContainer
    ).success,
    true
  );
  assert.match(malformedDrcContainer.allText, /Caller rectangles checked Unavailable/);
  assert.match(malformedDrcContainer.allText, /Rectangle rule flags Unavailable/);
  assert.match(malformedDrcContainer.allText, /Rule-screen status unavailable/);
  assert.doesNotMatch(malformedDrcContainer.allText, /<img src=x/);

  const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
  const edaRendererStart = appSource.indexOf('function renderEdaInspector()');
  const edaRendererEnd = appSource.indexOf('function renderAerospaceInspector()', edaRendererStart);
  assert(edaRendererStart >= 0 && edaRendererEnd > edaRendererStart, 'Expected the EDA result renderer');
  const edaRenderer = appSource.slice(edaRendererStart, edaRendererEnd);
  assert.match(edaRenderer, /OmniEdaResultView\?\.renderVerilogResult/);
  assert.match(edaRenderer, /OmniEdaResultView\?\.renderDrcResult/);
  assert.doesNotMatch(edaRenderer, /telem\.innerHTML\s*=/);

  const modalStart = appSource.indexOf('// Modal Verilog Synthesis');
  const modalEnd = appSource.indexOf('// Cloud HPC Modal', modalStart);
  assert(modalStart >= 0 && modalEnd > modalStart, 'Expected the Verilog modal renderer');
  const modalRenderer = appSource.slice(modalStart, modalEnd);
  assert.match(modalRenderer, /OmniEdaResultView\.renderVerilogResult/);
  assert.doesNotMatch(modalRenderer, /verilogResults\.innerHTML\s*=/);

  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  runEdaResultViewTests();
  console.log('EDA result view checks passed.');
}

module.exports = { runEdaResultViewTests };
