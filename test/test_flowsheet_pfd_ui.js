const assert = require('assert');
const { FlowsheetPfdUI } = require('../src/ui/flowsheet_pfd_ui');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.style = {};
    this._text = '';
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

function withFakeDocument(callback) {
  const originalDocument = global.document;
  const container = new FakeElement('div');
  Object.defineProperty(global, 'document', {
    configurable: true,
    value: {
      getElementById: () => container,
      createElement: (tagName) => new FakeElement(tagName)
    }
  });
  try {
    callback(container);
  } finally {
    if (originalDocument === undefined) delete global.document;
    else Object.defineProperty(global, 'document', { configurable: true, value: originalDocument });
  }
}

function runFlowsheetPfdUITests() {
  let total = 0;
  let passed = 0;
  const run = (name, callback) => {
    total++;
    try {
      callback();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      console.error(`  ✗ ${name}`);
      console.error(`    ${error.message}`);
    }
  };

  run('PFD displays caller-provided streams and operations without generated values', () => {
    withFakeDocument((container) => {
      const ui = new FlowsheetPfdUI('pfd');
      ui.render({
        success: true,
        solution: {
          streams: [
            {
              id: '<stream-1>',
              temperatureC: 31.25,
              pressureKPa: 202.5,
              vaporFraction: 0.4,
              molarFlowKmolH: 12.5,
              composition: { Water: 1 }
            }
          ],
          units: [{ id: 'P-1', type: 'PUMP', name: 'Caller pump' }]
        }
      });

      assert(container.textContent.includes('<stream-1>'));
      assert(container.textContent.includes('31.3'));
      assert(container.textContent.includes('202.50'));
      assert(container.textContent.includes('12.50'));
      assert(container.textContent.includes('Water: 1.000'));
      assert(container.textContent.includes('Caller pump (PUMP)'));
      assert(container.textContent.includes('Solver validity and independent accuracy are not assessed'));
      assert(!container.textContent.includes('Fresh Inflow'));
      assert(!container.textContent.includes('Aspen HYSYS'));
    });
  });

  run('PFD keeps unavailable solver results unavailable and shows the supplied reason', () => {
    withFakeDocument((container) => {
      const ui = new FlowsheetPfdUI('pfd');
      ui.render({ success: false, status: 'unavailable', error: 'No validated flowsheet schema is configured.' });
      assert(container.textContent.includes('No validated flowsheet schema is configured.'));
      assert(!container.textContent.includes('Stream ID'));
    });
  });

  console.log(`  PFD UI checks: ${passed}/${total} passed`);
  return { total, passed };
}

module.exports = { runFlowsheetPfdUITests };

if (require.main === module) {
  const stats = runFlowsheetPfdUITests();
  if (stats.passed !== stats.total) process.exit(1);
}
