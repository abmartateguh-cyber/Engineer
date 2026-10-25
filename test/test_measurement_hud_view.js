'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { renderMeasurementHud } = require('../src/ui/measurement_hud_view');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.textContent = '';
    this.attributes = new Map();
    this.children = [];
    this.style = {};
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
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

function runMeasurementHudViewTests() {
  const fakeDocument = { createElement: (tagName) => new FakeElement(tagName) };
  const hud = new FakeElement('div');

  assert.strictEqual(renderMeasurementHud(hud, fakeDocument, { phase: 'active' }).success, true);
  assert.match(hud.allText, /3D Caliper Measurement Active/);
  assert.match(hud.allText, /Click first 3D vertex/);

  assert.strictEqual(
    renderMeasurementHud(hud, fakeDocument, { phase: 'anchored', point: { x: 1.25, y: -2.5, z: 3 } }).success,
    true
  );
  assert.match(hud.allText, /P1\(1\.3, -2\.5, 3\.0\)/);
  assert.match(hud.allText, /Click second point/);

  assert.strictEqual(
    renderMeasurementHud(hud, fakeDocument, {
      phase: 'result',
      distance: 5,
      delta: { x: 3, y: 4, z: 0 }
    }).success,
    true
  );
  assert.match(hud.allText, /Length: 5\.00 mm/);
  assert.match(hud.allText, /ΔX: 3\.00 mm \| ΔY: 4\.00 mm \| ΔZ: 0\.00 mm/);

  const hostile = '</span><img src=x onerror=alert(1)>';
  assert.strictEqual(
    renderMeasurementHud(hud, fakeDocument, {
      phase: 'anchored',
      point: { x: hostile, y: 0, z: 0 }
    }).success,
    true
  );
  assert.match(hud.allText, /measurement coordinates are unavailable/i);
  assert.doesNotMatch(hud.allText, /<img src=x/);

  assert.strictEqual(
    renderMeasurementHud(hud, fakeDocument, {
      phase: 'result',
      distance: Number.POSITIVE_INFINITY,
      delta: { x: 3, y: Number.NaN, z: 0 }
    }).success,
    true
  );
  assert.match(hud.allText, /measurement values are unavailable/i);
  assert.doesNotMatch(hud.allText, /Infinity|NaN/);

  const viewportSource = fs.readFileSync(path.join(__dirname, '../src/ui/viewport3d.js'), 'utf8');
  const measurementStart = viewportSource.indexOf('toggleMeasureTool(active) {');
  const measurementEnd = viewportSource.indexOf('// Transient experimental impact estimate player', measurementStart);
  assert(measurementStart >= 0 && measurementEnd > measurementStart, 'Expected the viewport measurement controls');
  const measurementRenderer = viewportSource.slice(measurementStart, measurementEnd);
  assert.match(measurementRenderer, /OmniMeasurementHudView\.renderMeasurementHud/);
  assert.doesNotMatch(measurementRenderer, /innerHTML\s*=/);

  const indexHtml = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const viewScriptIndex = indexHtml.indexOf('<script src="ui/measurement_hud_view.js"></script>');
  const viewportScriptIndex = indexHtml.indexOf('<script src="ui/viewport3d.js"></script>');
  assert(
    viewScriptIndex >= 0 && viewScriptIndex < viewportScriptIndex,
    'Expected the HUD view helper to load before the viewport'
  );

  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  runMeasurementHudViewTests();
  console.log('Measurement HUD view checks passed.');
}

module.exports = { runMeasurementHudViewTests };
