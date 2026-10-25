'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createCommandPaletteItem } = require('../src/ui/command_palette_view');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.textContent = '';
    this.attributes = new Map();
    this.children = [];
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

function runCommandPaletteViewTests() {
  const fakeDocument = { createElement: (tagName) => new FakeElement(tagName) };
  const hostileCommand = {
    id: 'item" data-owned="yes',
    title: '<img src=x onerror=alert(1)>',
    desc: '</div><svg onload=alert(2)>',
    category: '<script>alert(3)</script>',
    icon: '<svg onload=alert(4)>'
  };
  const item = createCommandPaletteItem(fakeDocument, hostileCommand, 3, true);

  assert.strictEqual(item.tagName, 'DIV');
  assert.strictEqual(item.className, 'command-item selected');
  assert.strictEqual(item.attributes.get('data-cmd-index'), '3');
  assert.strictEqual(item.attributes.get('data-cmd-id'), hostileCommand.id);
  assert.strictEqual(item.children.length, 2);

  const [left, right] = item.children;
  const [icon, textContainer] = left.children;
  const [title, description] = textContainer.children;
  const category = right.children[0];
  assert.strictEqual(icon.className, 'command-item-icon icon-slot');
  assert.strictEqual(icon.attributes.get('data-omni-icon'), hostileCommand.icon);
  assert.strictEqual(icon.textContent, '');
  assert.strictEqual(title.textContent, hostileCommand.title);
  assert.strictEqual(description.textContent, hostileCommand.desc);
  assert.strictEqual(category.textContent, hostileCommand.category);
  assert.match(item.allText, /<img src=x onerror=alert\(1\)>/);
  assert.match(item.allText, /<svg onload=alert\(2\)>/);
  assert.match(item.allText, /<script>alert\(3\)<\/script>/);
  assert.doesNotMatch(item.allText, /alert\(4\)/);

  const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
  const paletteStart = appSource.indexOf('function renderPaletteResults() {');
  const paletteEnd = appSource.indexOf('if (paletteInput) {', paletteStart);
  assert(paletteStart >= 0 && paletteEnd > paletteStart, 'Expected the command-palette renderer');
  const paletteRenderer = appSource.slice(paletteStart, paletteEnd);
  assert.match(paletteRenderer, /OmniCommandPaletteView\.createCommandPaletteItem/);
  assert.match(paletteRenderer, /OmniIcons\.hydrateAll\(paletteResults\)/);
  assert.doesNotMatch(paletteRenderer, /innerHTML\s*=/);

  const indexHtml = fs.readFileSync(path.join(__dirname, '../src/index.html'), 'utf8');
  const viewScriptIndex = indexHtml.indexOf('<script src="ui/command_palette_view.js"></script>');
  const appScriptIndex = indexHtml.indexOf('<script src="ui/app.js"></script>');
  assert(
    viewScriptIndex >= 0 && viewScriptIndex < appScriptIndex,
    'Expected the palette view helper to load before app.js'
  );

  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  runCommandPaletteViewTests();
  console.log('Command palette view checks passed.');
}

module.exports = { runCommandPaletteViewTests };
