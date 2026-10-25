'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPropertyGridElements, readOptionalNumberInput } = require('../src/ui/property_grid_view');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.textContent = '';
    this.value = '';
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

  get allText() {
    return [this.textContent, ...this.children.map((child) => child.allText)].filter(Boolean).join(' ');
  }
}

function findById(elements, id) {
  for (const element of elements) {
    if (element.id === id) return element;
    const nested = findById(element.children, id);
    if (nested) return nested;
  }
  return null;
}

function findByClass(elements, className) {
  for (const element of elements) {
    if (element.className.split(/\s+/).includes(className)) return element;
    const nested = findByClass(element.children, className);
    if (nested) return nested;
  }
  return null;
}

function runPropertyGridViewTests() {
  const fakeDocument = { createElement: (tagName) => new FakeElement(tagName) };
  const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const elements = createPropertyGridElements(
    fakeDocument,
    {
      name: hostile,
      type: '</div><svg onload=alert(3)>',
      position: { x: 1.5, y: Number.NaN, z: -2 },
      dimensions: { width: 10, height: 20, depth: 30 },
      materialName: `\"><script>${hostile}`,
      delay: hostile,
      net: '<svg onload=alert(4)>',
      temp: '25 °C',
      press: '100 kPa',
      wbsId: hostile
    },
    true
  );

  assert.strictEqual(elements.length, 6);
  assert.strictEqual(findByClass(elements, 'prop-entity-title').textContent, hostile);
  assert.strictEqual(findByClass(elements, 'prop-entity-type').textContent, '</div><svg onload=alert(3)>');
  assert.strictEqual(
    findByClass(elements, 'prop-entity-header').children[0].children[0].attributes.get('data-omni-icon'),
    'assembly'
  );
  assert.strictEqual(findById(elements, 'prop-input-pos-x').value, '1.5');
  assert.strictEqual(findById(elements, 'prop-input-pos-y').value, '');
  assert.strictEqual(findById(elements, 'prop-input-pos-z').value, '-2');
  assert.strictEqual(findById(elements, 'prop-input-material-label').value, `\"><script>${hostile}`);
  assert.strictEqual(findById(elements, 'prop-input-delay').value, hostile);
  assert.strictEqual(findById(elements, 'prop-input-net').value, '<svg onload=alert(4)>');
  assert.strictEqual(findById(elements, 'btn-inspect-wbs-entity').textContent, 'View subsystem data availability');
  assert(elements[2].allText.includes('10 x 20 x 30'));
  assert(!elements.some((element) => element.innerHTML !== undefined));

  const invalidGeometry = createPropertyGridElements(
    fakeDocument,
    { w: Number.NaN, h: Number.POSITIVE_INFINITY },
    false
  );
  assert.strictEqual(findById(invalidGeometry, 'prop-input-pos-z'), null);
  assert.strictEqual(findById(invalidGeometry, 'prop-input-material-label'), null);
  assert.strictEqual(findById(invalidGeometry, 'prop-input-w').value, '');
  assert.strictEqual(findById(invalidGeometry, 'prop-input-h').value, '');
  assert.strictEqual(readOptionalNumberInput({ value: '0' }), 0);
  assert.strictEqual(readOptionalNumberInput({ value: '  ' }), null);
  assert.strictEqual(readOptionalNumberInput({ value: 'not a number' }), null);
  assert.strictEqual(readOptionalNumberInput(null), null);
  assert.strictEqual(
    findByClass(invalidGeometry, 'prop-entity-header').children[0].children[0].attributes.get('data-omni-icon'),
    'studioEda'
  );
  assert.strictEqual(createPropertyGridElements(fakeDocument, null, true).length, 0);

  const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
  const renderStart = appSource.indexOf('function renderPropertyGrid(');
  const renderEnd = appSource.indexOf('function syncPropertyGridInputs(', renderStart + 1);
  assert(renderStart >= 0 && renderEnd > renderStart, 'Expected the live property-grid renderer');
  const propertyGridRenderer = appSource.slice(renderStart, renderEnd);
  assert.match(propertyGridRenderer, /OmniPropertyGridView\?\.createPropertyGridElements/);
  assert.match(propertyGridRenderer, /propertyGridContent\.replaceChildren/);
  assert.doesNotMatch(propertyGridRenderer, /innerHTML/);
  assert.match(propertyGridRenderer, /window\.OmniPropertyGridView\.readOptionalNumberInput/);
  assert.match(propertyGridRenderer, /if \(value !== null\) position\[axis\] = value/);
  assert.match(propertyGridRenderer, /if \(value !== null\) changes\[key\] = value/);
  assert.doesNotMatch(propertyGridRenderer, /parseFloat\(in[XYZWH].*\|\|/);

  const indexHtml = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const viewIndex = indexHtml.indexOf('<script src="ui/property_grid_view.js"></script>');
  const appIndex = indexHtml.indexOf('<script src="ui/app.js"></script>');
  assert(viewIndex >= 0 && viewIndex < appIndex, 'Expected property-grid helper to load before app.js');

  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  runPropertyGridViewTests();
  console.log('Property-grid view checks passed.');
}

module.exports = { runPropertyGridViewTests };
