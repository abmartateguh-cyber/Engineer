'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FrequencyResponseAnalyzer } = require('../src/core/dynamic_simulink/frequency_analysis');
const { fromAnalyzerResult, getSyntheticPreset, render } = require('../src/ui/bode_chart_model');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
    this.className = '';
    this.textContent = '';
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

  get allText() {
    return [this.textContent, ...this.children.map((child) => child.allText)].filter(Boolean).join(' ');
  }
}

function runBodeUiContractTests() {
  const analyzerResult = FrequencyResponseAnalyzer.computeBode([144], [1, 13.2, 144], 0.1, 1000, 80);
  assert.strictEqual(analyzerResult.validationLevel, 'experimental');
  assert.strictEqual(analyzerResult.frequencies, undefined);
  assert.strictEqual(analyzerResult.stabilityMargins, undefined);

  assert.deepStrictEqual(getSyntheticPreset('synthetic_second_order'), {
    numCoeffs: [144],
    denCoeffs: [1, 13.2, 144]
  });
  assert.deepStrictEqual(getSyntheticPreset('synthetic_actuator'), {
    numCoeffs: [250],
    denCoeffs: [1, 15, 200]
  });
  assert.deepStrictEqual(getSyntheticPreset('synthetic_first_order'), {
    numCoeffs: [10],
    denCoeffs: [45, 1]
  });
  assert.strictEqual(getSyntheticPreset(undefined), null);
  assert.strictEqual(getSyntheticPreset('unrecognized'), null);
  assert.strictEqual(getSyntheticPreset('constructor'), null);
  assert.strictEqual(getSyntheticPreset('toString'), null);
  assert.strictEqual(getSyntheticPreset('__proto__'), null);

  const model = fromAnalyzerResult(analyzerResult);
  assert.strictEqual(model.success, true);
  assert.strictEqual(model.frequencies.length, 80);
  assert.deepStrictEqual(
    model.frequencies,
    analyzerResult.bodePoints.map((point) => point.omegaRadS)
  );
  assert.deepStrictEqual(
    model.magnitudeDB,
    analyzerResult.bodePoints.map((point) => point.magnitudeDb)
  );
  assert.deepStrictEqual(
    model.phaseDeg,
    analyzerResult.bodePoints.map((point) => point.phaseDeg)
  );
  assert.strictEqual(model.gainMarginDb, analyzerResult.gainMarginDb);
  assert.strictEqual(model.phaseMarginDeg, analyzerResult.phaseMarginDeg);
  assert.strictEqual(model.isClosedLoopStable, undefined);
  assert.strictEqual(model.bandwidthRadS, undefined);

  const fakeDocument = {
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName)
  };
  const chartContainer = new FakeElement('div');
  const summaryContainer = new FakeElement('div');
  assert.deepStrictEqual(render(analyzerResult, fakeDocument, chartContainer, summaryContainer), { success: true });
  assert.strictEqual(chartContainer.children.length, 1);
  assert.strictEqual(chartContainer.children[0].tagName, 'svg');
  assert.strictEqual(chartContainer.children[0].attributes.viewBox, '0 0 820 370');
  assert.strictEqual(chartContainer.children[0].children.filter((child) => child.tagName === 'polyline').length, 2);
  assert.strictEqual(summaryContainer.children[0].children[0].children.length, 4);
  assert.match(summaryContainer.allText, /sampled crossover estimates without interpolation or refinement/);
  assert.match(summaryContainer.allText, /No closed-loop stability verdict or bandwidth is calculated/);
  assert.doesNotMatch(summaryContainer.allText, /Stable in this estimate|Control Authority Limit/);

  const duplicateFrequency = {
    ...analyzerResult,
    bodePoints: [
      analyzerResult.bodePoints[0],
      { ...analyzerResult.bodePoints[1], omegaRadS: analyzerResult.bodePoints[0].omegaRadS }
    ]
  };
  assert.strictEqual(fromAnalyzerResult(duplicateFrequency).success, false);

  const nonFiniteSample = {
    ...analyzerResult,
    bodePoints: [
      { ...analyzerResult.bodePoints[0], magnitudeDb: Number.POSITIVE_INFINITY },
      ...analyzerResult.bodePoints.slice(1)
    ]
  };
  assert.strictEqual(fromAnalyzerResult(nonFiniteSample).success, false);
  const invalidChart = new FakeElement('div');
  const invalidSummary = new FakeElement('div');
  assert.strictEqual(render(nonFiniteSample, fakeDocument, invalidChart, invalidSummary).success, false);
  assert.match(invalidChart.textContent, /finite samples/);
  assert.strictEqual(invalidSummary.textContent, 'No margin values are available.');

  const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
  assert.ok(
    /OmniBodeChartModel\.render\(data, document, bodeSvgContainer, bodeMetricsSummary\)/.test(appSource),
    'The workbench must use the tested Bode chart renderer'
  );
  assert.ok(
    /getSyntheticPreset\(bodePresetSelect\?\.value\)/.test(appSource),
    'The workbench must reject a missing or unsupported preset instead of choosing a default'
  );
  assert.ok(!/bodePresetSelect\s*\?\s*bodePresetSelect\.value\s*:\s*'synthetic_second_order'/.test(appSource));
  assert.ok(!/bodeSvgContainer\.innerHTML\s*=/.test(appSource), 'Bode samples must not be interpolated into HTML');
  assert.ok(!/bodeMetricsSummary\.innerHTML\s*=/.test(appSource), 'Bode margins must be rendered as text nodes');
  assert.ok(
    !/isClosedLoopStable|bandwidthRadS/.test(appSource),
    'The UI must not display stability or bandwidth values the engine does not calculate'
  );

  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  runBodeUiContractTests();
  console.log('Bode UI contract checks passed.');
}

module.exports = { runBodeUiContractTests };
