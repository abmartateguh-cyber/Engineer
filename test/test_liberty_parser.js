/**
 * OmniEng Liberty (.lib) parser verification.
 * Feeds a small inline .lib snippet, parses it, interpolates delay values,
 * and asserts exact table corner values, bilinear interpolation continuity,
 * and fail-closed rejection of malformed input.
 */

'use strict';

const assert = require('assert');
const { parseLiberty, LibertyTable } = require('../src/core/eda/liberty_parser');

const LIB_SNIPPET = `library (demo_lib) {
  delay_model : table_lookup;
  time_unit : "1ns";
  capacitance_unit : "1pf";
  voltage_unit : "1V";
  current_unit : "1mA";
  resistance_unit : "1kohm";
  leakage_power_unit : "1nW";

  /* 2-input inverter with full 2D timing arcs */
  cell (INV_X1) {
    area : 1.8;
    pin (A) {
      direction : input;
      capacitance : 0.002;
    }
    pin (Y) {
      direction : output;
      capacitance : 0.001;
      timing () {
        related_pin : "A";
        timing_type : rising_edge;
        cell_rise (delay_template_2x2) {
          index_1 ("0.01, 0.05, 0.2");
          index_2 ("0.001, 0.005, 0.05");
          values (
            "0.020, 0.035, 0.080",
            "0.030, 0.045, 0.090",
            "0.050, 0.065, 0.110"
          );
        }
        cell_fall (delay_template_2x2) {
          index_1 ("0.01, 0.05, 0.2");
          index_2 ("0.001, 0.005, 0.05");
          values (
            "0.018, 0.032, 0.075",
            "0.028, 0.042, 0.085",
            "0.048, 0.062, 0.105"
          );
        }
        rise_transition (slew_template_2x2) {
          index_1 ("0.01, 0.05, 0.2");
          index_2 ("0.001, 0.005, 0.05");
          values (
            "0.012, 0.020, 0.040",
            "0.016, 0.026, 0.048",
            "0.022, 0.034, 0.060"
          );
        }
        fall_transition (slew_template_2x2) {
          index_1 ("0.01, 0.05, 0.2");
          index_2 ("0.001, 0.005, 0.05");
          values (
            "0.010, 0.018, 0.038",
            "0.014, 0.024, 0.046",
            "0.020, 0.032, 0.058"
          );
        }
      }
    }
  }

  cell (NAND2_X1) {
    area : 2.4;
    cell_leakage_power : 0.0001;
    pin (A) {
      direction : input;
      capacitance : 0.003;
    }
    pin (B) {
      direction : input;
      capacitance : 0.003;
    }
    pin (ZN) {
      direction : output;
      capacitance : 0.002;
      timing () {
        related_pin : "A";
        timing_type : rising_edge;
        cell_rise (0.07);
        rise_transition (0.05);
      }
    }
  }
}
`;

function runLibertyParserTests() {
  const checks = [];
  const check = (name, fn) => {
    try {
      fn();
      checks.push({ name, passed: true });
    } catch (err) {
      checks.push({ name, passed: false, error: err.message });
    }
  };

  // ---------------------------------------------------------------------
  // Parse the sample library
  // ---------------------------------------------------------------------
  let lib;
  check('parse sample .lib library', () => {
    lib = parseLiberty(LIB_SNIPPET);
  });

  check('library header: name and units', () => {
    assert.strictEqual(lib.name, 'demo_lib');
    assert.strictEqual(lib.units.time_unit, '1ns');
    assert.strictEqual(lib.units.capacitance_unit, '1pf');
    assert.strictEqual(lib.units.voltage_unit, '1V');
    assert.strictEqual(lib.units.current_unit, '1mA');
    assert.strictEqual(lib.units.resistance_unit, '1kohm');
    assert.strictEqual(lib.units.leakage_power_unit, '1nW');
    assert.strictEqual(lib.delayModel, 'table_lookup');
  });

  check('cells and pins populated', () => {
    assert.strictEqual(lib.cells.size, 2);
    const inv = lib.getCell('INV_X1');
    assert.ok(inv);
    assert.strictEqual(inv.area, 1.8);
    assert.strictEqual(inv.pins.size, 2);
    assert.strictEqual(inv.pins.get('A').direction, 'input');
    assert.strictEqual(inv.pins.get('A').capacitance, 0.002);
    assert.strictEqual(inv.pins.get('Y').direction, 'output');
    assert.strictEqual(inv.pins.get('Y').timings.length, 1);
    const nand = lib.getCell('NAND2_X1');
    assert.ok(nand);
    assert.strictEqual(nand.area, 2.4);
    assert.strictEqual(nand.cellLeakagePower, 0.0001);
    assert.strictEqual(nand.pins.size, 3);
  });

  // ---------------------------------------------------------------------
  // Timing table dimensions and exact corners
  // ---------------------------------------------------------------------
  let riseTable;
  check('timing arcs present; cell_rise is a 2D table', () => {
    const inv = lib.getCell('INV_X1');
    const timing = inv.pins.get('Y').timings[0];
    assert.strictEqual(timing.relatedPin, 'A');
    assert.strictEqual(timing.timingType, 'rising_edge');
    assert.ok(timing.arcs.cellRise instanceof LibertyTable);
    assert.ok(timing.arcs.cellFall instanceof LibertyTable);
    assert.ok(timing.arcs.riseTransition instanceof LibertyTable);
    assert.ok(timing.arcs.fallTransition instanceof LibertyTable);
    riseTable = timing.arcs.cellRise;
    assert.strictEqual(riseTable.rows, 3);
    assert.strictEqual(riseTable.cols, 3);
  });

  check('exact table corner values', () => {
    assert.strictEqual(riseTable.lookup(0.01, 0.001), 0.02);
    assert.strictEqual(riseTable.lookup(0.2, 0.05), 0.11);
    assert.strictEqual(riseTable.lookup(0.05, 0.005), 0.045);
    assert.strictEqual(riseTable.lookup(0.01, 0.05), 0.08);
    assert.strictEqual(riseTable.lookup(0.2, 0.001), 0.05);
  });

  check('bilinear interpolation continuity', () => {
    // Mid-edge of the cell between (0.01,0.001) and (0.05,0.001):
    // bilinear interpolant on that edge is the linear average.
    const midEdge = riseTable.lookup(0.03, 0.001);
    assert(Math.abs(midEdge - (0.02 + 0.03) / 2) < 1e-12);

    // Interior point matches the closed-form bilinear formula.
    const x = 0.09;
    const y = 0.003;
    const u = (0.09 - 0.05) / (0.2 - 0.05);
    const v = (0.003 - 0.001) / (0.005 - 0.001);
    const expected = (1 - u) * (1 - v) * 0.03 + u * (1 - v) * 0.05 + (1 - u) * v * 0.045 + u * v * 0.065;
    assert(Math.abs(riseTable.lookup(x, y) - expected) < 1e-12);

    // Continuity across the cell boundary x = 0.05 (evaluate from both sides).
    const left = riseTable.lookup(0.05 - 1e-12, 0.003);
    const right = riseTable.lookup(0.05 + 1e-12, 0.003);
    assert(Math.abs(left - right) < 1e-9);
  });

  check('scalar timing arc returns constant', () => {
    const nand = lib.getCell('NAND2_X1');
    const timing = nand.pins.get('ZN').timings[0];
    assert.strictEqual(timing.arcs.cellRise, 0.07);
    assert.strictEqual(timing.cellRiseDelay(0.1, 0.01), 0.07);
    assert.strictEqual(timing.riseTransitionDelay(0.5, 0.02), 0.05);
  });

  // ---------------------------------------------------------------------
  // Fail-closed rejection of malformed / unsupported input
  // ---------------------------------------------------------------------
  const malformedSnippets = [
    ['unbalanced braces', 'library (x) { cell (y) { area : 1; }'],
    ['missing semicolon', 'library (x) { cell (y) { area : 1.5 } }'],
    ['unknown library construct', 'library (x) { operating_conditions (ss) { } }'],
    ['unknown cell attribute', 'library (x) { cell (y) { foo : 1; } }'],
    ['unknown pin attribute', 'library (x) { cell (y) { pin (p) { direction : input; foo : 1; } } }'],
    [
      'unknown timing arc key',
      'library (x) { cell (y) { pin (p) { direction : input; timing () { related_pin : "a"; timing_type : rising_edge; cell_constraint (0.1); } } } }'
    ],
    [
      'unsupported timing_type',
      'library (x) { cell (y) { pin (p) { direction : input; timing () { related_pin : "a"; timing_type : weird; } } } }'
    ],
    [
      'table dimension mismatch',
      `library (x) { cell (y) { pin (p) { direction : input; timing () { related_pin : "a"; timing_type : rising_edge; cell_rise (t) { index_1 ("0.01, 0.05"); index_2 ("0.001, 0.005"); values ("0.1, 0.2, 0.3", "0.4, 0.5, 0.6"); } } } } }`
    ],
    [
      'missing index_1',
      `library (x) { cell (y) { pin (p) { direction : input; timing () { related_pin : "a"; timing_type : rising_edge; cell_rise (t) { index_2 ("0.001, 0.005"); values ("0.1, 0.2", "0.3, 0.4"); } } } } }`
    ],
    [
      'non-numeric index',
      `library (x) { cell (y) { pin (p) { direction : input; timing () { related_pin : "a"; timing_type : rising_edge; cell_rise (t) { index_1 ("foo, 0.05"); index_2 ("0.001, 0.005"); values ("0.1, 0.2", "0.3, 0.4"); } } } } }`
    ],
    ['empty library', ''],
    ['no library keyword', 'cell (x) { }'],
    ['pin missing direction', 'library (x) { cell (y) { pin (p) { capacitance : 0.1; } } }'],
    [
      'timing missing related_pin',
      'library (x) { cell (y) { pin (p) { direction : input; timing () { timing_type : rising_edge; } } } }'
    ],
    ['duplicate cell', 'library (x) { cell (y) { } cell (y) { } }'],
    ['duplicate attribute', 'library (x) { cell (y) { area : 1; area : 2; } }'],
    ['unterminated string', 'library (x) { time_unit : "1ns; }']
  ];
  for (const [label, snippet] of malformedSnippets) {
    check(`reject: ${label}`, () => {
      assert.throws(() => parseLiberty(snippet), Error);
    });
  }

  const passed = checks.filter((c) => c.passed).length;
  const failed = checks.length - passed;
  return {
    suite: 'Liberty (.lib) parser',
    total: checks.length,
    passed,
    failed,
    checks,
    passedAll: failed === 0
  };
}

module.exports = { runLibertyParserTests };

if (require.main === module) {
  const summary = runLibertyParserTests();
  for (const c of summary.checks) {
    const state = c.passed ? 'PASS' : 'FAIL';
    console.log(`[${state}] ${c.name}`);
    if (!c.passed) console.log(`        ${c.error}`);
  }
  console.log(`\nLiberty parser: ${summary.passed}/${summary.total} checks passed`);
  process.exitCode = summary.passedAll ? 0 : 1;
}
