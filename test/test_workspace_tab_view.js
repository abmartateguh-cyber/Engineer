'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createWorkspaceTab } = require('../src/ui/workspace_tab_view');

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

function runWorkspaceTabViewTests() {
  const fakeDocument = { createElement: (tagName) => new FakeElement(tagName) };
  const hostileTitle = '</span><img src=x onerror=alert(1)>';
  const hostileBadge = '<svg onload=alert(2)>';
  const tab = createWorkspaceTab(fakeDocument, {
    docId: 'doc-test-1',
    title: hostileTitle,
    badge: hostileBadge,
    active: true
  });

  assert.strictEqual(tab.tagName, 'DIV');
  assert.strictEqual(tab.className, 'workspace-tab active');
  assert.strictEqual(tab.attributes.get('data-doc-id'), 'doc-test-1');
  assert.strictEqual(tab.children.length, 4);
  assert.deepStrictEqual(
    tab.children.map((child) => child.tagName),
    ['SPAN', 'SPAN', 'SPAN', 'SPAN']
  );
  assert.strictEqual(tab.children[1].className, 'doc-title');
  assert.strictEqual(tab.children[1].textContent, hostileTitle);
  assert.strictEqual(tab.children[2].className, 'doc-badge');
  assert.strictEqual(tab.children[2].textContent, hostileBadge);
  assert.strictEqual(tab.children[3].className, 'doc-close-btn');
  assert.strictEqual(tab.children[3].textContent, '×');
  assert.match(tab.allText, /<img src=x onerror=alert\(1\)>/);
  assert.match(tab.allText, /<svg onload=alert\(2\)>/);
  assert.doesNotMatch(tab.children.map((child) => child.tagName).join(' '), /IMG|SVG/);

  const appSource = fs.readFileSync(path.join(__dirname, '../src/ui/app.js'), 'utf8');
  const tabsStart = appSource.indexOf('// --- 3. Multi-Document Workspace Tab Bar ---');
  const tabsEnd = appSource.indexOf('// --- 4. Global Command Palette', tabsStart);
  assert(tabsStart >= 0 && tabsEnd > tabsStart, 'Expected the workspace-tab renderer');
  const tabsRenderer = appSource.slice(tabsStart, tabsEnd);
  assert.match(tabsRenderer, /OmniWorkspaceTabView\.createWorkspaceTab/);
  assert.doesNotMatch(tabsRenderer, /tabEl\.innerHTML\s*=/);

  return { total: 1, passed: 1, failed: 0 };
}

if (require.main === module) {
  runWorkspaceTabViewTests();
  console.log('Workspace tab view checks passed.');
}

module.exports = { runWorkspaceTabViewTests };
