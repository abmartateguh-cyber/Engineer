'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { OpticalEngine } = require('../src/core/optics/optical_engine');
const { PipingStressEngine } = require('../src/core/plant/piping_stress');
const { renderOpticsEstimateResult, renderPipingStressResult } = require('../src/ui/engineering_result_view');

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

function runEngineeringResultViewTests() {
  const fakeDocument = { createElement: (tagName) => new FakeElement(tagName) };
  const hostileValue = '</span><img src=x onerror=alert(1)>';

  const optics = OpticalEngine.solveOpticalMetrics(50, 2, 2, 550, 0.03);
  const opticsContainer = new FakeElement('div');
  assert.strictEqual(renderOpticsEstimateResult(optics, fakeDocument, opticsContainer).success, true);
  assert.match(opticsContainer.allText, /Entrance Pupil Diameter \(D\) 25 mm/);
  assert.match(opticsContainer.allText, /Airy Disk Diameter 550 nm · 2.68 µm/);
  assert.match(opticsContainer.allText, /Experimental scalar optics estimate/);

  const infiniteDofContainer = new FakeElement('div');
  const infiniteDof = { ...optics, depthOfField_m: 'Infinity', farFocusLimit_m: 'Infinity' };
  assert.strictEqual(renderOpticsEstimateResult(infiniteDof, fakeDocument, infiniteDofContainer).success, true);
  assert.match(infiniteDofContainer.allText, /Depth of Field \(DoF\) Infinity m/);
  assert.match(infiniteDofContainer.allText, /Focus Limits \(Near \/ Far\).*Infinity m/);

  const malformedOpticsContainer = new FakeElement('div');
  assert.strictEqual(
    renderOpticsEstimateResult(
      { ...optics, entrancePupilDiameterMm: hostileValue, numericalAperture: Number.NaN, depthOfField_m: hostileValue },
      fakeDocument,
      malformedOpticsContainer
    ).success,
    true
  );
  assert.match(malformedOpticsContainer.allText, /Entrance Pupil Diameter \(D\) Unavailable/);
  assert.match(malformedOpticsContainer.allText, /Numerical Aperture \(NA\) Unavailable/);
  assert.match(malformedOpticsContainer.allText, /Depth of Field \(DoF\) Unavailable/);
  assert.doesNotMatch(malformedOpticsContainer.allText, /<img src=x/);

  const pipe = PipingStressEngine.evaluateASMEB313({
    pipeOuterDiameterMm: 100,
    nominalWallThicknessMm: 8,
    youngsModulusGPa: 200,
    thermalExpansionPerK: 0.000012,
    designPressureBar: 10,
    operatingTempC: 120,
    ambientTempC: 20,
    straightLengthM: 10,
    hasExpansionLoop: false,
    corrosionAllowanceMm: 1
  });
  const pipeContainer = new FakeElement('div');
  assert.strictEqual(renderPipingStressResult(pipe, fakeDocument, pipeContainer).success, true);
  assert.match(pipeContainer.allText, /Illustrative pressure hoop stress 7.143 MPa/);
  assert.match(pipeContainer.allText, /Thermal elongation 12 mm/);
  assert.match(pipeContainer.allText, /not a code allowable or compliance decision/);

  const malformedPipeContainer = new FakeElement('div');
  assert.strictEqual(
    renderPipingStressResult(
      {
        success: true,
        hoopStress_MPa: hostileValue,
        thermalElongation_mm: Number.POSITIVE_INFINITY,
        expansionStress_MPa: 2
      },
      fakeDocument,
      malformedPipeContainer
    ).success,
    true
  );
  assert.match(malformedPipeContainer.allText, /Illustrative pressure hoop stress Unavailable/);
  assert.match(malformedPipeContainer.allText, /Thermal elongation Unavailable/);
  assert.doesNotMatch(malformedPipeContainer.allText, /<img src=x/);

  const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
  const opticsStart = appSource.indexOf('async function updateOpticalTelemetry()');
  const opticsEnd = appSource.indexOf('function refreshLens3D()', opticsStart);
  assert(opticsStart >= 0 && opticsEnd > opticsStart, 'Expected the scalar optics result renderer');
  const opticsRenderer = appSource.slice(opticsStart, opticsEnd);
  assert.match(opticsRenderer, /OmniEngineeringResultView\?\.renderOpticsEstimateResult/);
  assert.doesNotMatch(opticsRenderer, /container\.innerHTML\s*=/);

  const pipeStart = appSource.indexOf("document.getElementById('btn-run-pipe')?.addEventListener");
  const pipeEnd = appSource.indexOf('// Add Direct Chemical Thermodynamics Inspection Buttons', pipeStart);
  assert(pipeStart >= 0 && pipeEnd > pipeStart, 'Expected the piping result renderer');
  const pipeRenderer = appSource.slice(pipeStart, pipeEnd);
  assert.match(pipeRenderer, /OmniEngineeringResultView\?\.renderPipingStressResult/);
  assert.doesNotMatch(pipeRenderer, /telem\.innerHTML\s*=/);

  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  runEngineeringResultViewTests();
  console.log('Engineering result view checks passed.');
}

module.exports = { runEngineeringResultViewTests };
