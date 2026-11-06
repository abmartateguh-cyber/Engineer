/**
 * Experimental toy RTL parser and gate-delay estimator.
 * It is not a production synthesis or static-timing implementation.
 */

// Illustrative gate values; these are not a characterized technology library.
const STANDARD_CELL_LIB = {
  INV: { inputs: ['A'], output: 'Y', delay_ps: 12.0, area_um2: 0.8, leakage_uW: 0.05 },
  NAND2: { inputs: ['A', 'B'], output: 'Y', delay_ps: 18.0, area_um2: 1.2, leakage_uW: 0.08 },
  NOR2: { inputs: ['A', 'B'], output: 'Y', delay_ps: 22.0, area_um2: 1.4, leakage_uW: 0.09 },
  AND2: { inputs: ['A', 'B'], output: 'Y', delay_ps: 25.0, area_um2: 1.6, leakage_uW: 0.12 },
  OR2: { inputs: ['A', 'B'], output: 'Y', delay_ps: 28.0, area_um2: 1.8, leakage_uW: 0.14 },
  XOR2: { inputs: ['A', 'B'], output: 'Y', delay_ps: 35.0, area_um2: 2.4, leakage_uW: 0.2 },
  DFF: { inputs: ['D', 'CLK'], output: 'Q', delay_ps: 45.0, area_um2: 4.8, leakage_uW: 0.35, setup_ps: 25.0 }
};

class LogicSynthesisEngine {
  /**
   * Synthesize Verilog RTL code into gate netlist
   * @param {string} verilogSource Verilog module source text
   */
  static synthesize(verilogSource, options = {}) {
    if (typeof verilogSource !== 'string' || verilogSource.trim() === '') {
      throw new TypeError('Explicit non-empty Verilog source is required.');
    }
    const lines = verilogSource
      .split('\n')
      .map((line) => line.split('//')[0].trim())
      .filter(Boolean);

    let moduleName = null;
    const inputs = [];
    const outputs = [];
    const gates = [];

    for (const line of lines) {
      if (line.startsWith('module')) {
        const match = line.match(/module\s+([A-Za-z0-9_]+)/);
        if (!match) throw new TypeError('The module declaration could not be recognized.');
        moduleName = match[1];
      } else if (line.startsWith('input')) {
        const parts = line
          .replace('input', '')
          .replace(/reg|wire/g, '')
          .replace(/\[[^\]]+\]/g, '')
          .replace(/[;()]/g, '')
          .split(',');
        parts
          .map((p) => p.trim())
          .filter(Boolean)
          .forEach((p) => inputs.push(p));
      } else if (line.startsWith('output')) {
        const parts = line
          .replace('output', '')
          .replace(/reg|wire/g, '')
          .replace(/\[[^\]]+\]/g, '')
          .replace(/[;()]/g, '')
          .split(',');
        parts
          .map((p) => p.trim())
          .filter(Boolean)
          .forEach((p) => outputs.push(p));
      } else if (line.startsWith('assign')) {
        // Parse one assignment using one supported Boolean operator.
        const match = line.match(/^assign\s+([A-Za-z_][A-Za-z0-9_$]*)\s*=\s*(.+);$/);
        if (!match) throw new TypeError('A simple single-line Verilog assignment is required.');
        const outNet = match[1].trim();
        const expr = match[2].trim();
        this._mapExpressionToGates(expr, outNet, gates);
      } else if (line.includes('<=') && line.includes('posedge')) {
        const match = line.match(/([A-Za-z_][A-Za-z0-9_$]*)\s*<=\s*([A-Za-z_][A-Za-z0-9_$]*)\s*;/);
        if (!match)
          throw new Error(
            'UNSUPPORTED: Only a single-line identifier-to-identifier edge-triggered assignment is supported.'
          );
        gates.push({
          id: `U_${gates.length + 1}`,
          cell: 'DFF',
          inputs: { D: match[2].trim(), CLK: 'clk' },
          output: match[1].trim()
        });
      }
    }

    if (!moduleName) throw new TypeError('A Verilog module declaration is required.');
    if (gates.length === 0) {
      return {
        success: false,
        status: 'unavailable',
        validationLevel: 'experimental',
        error: {
          code: 'UNSUPPORTED',
          message: 'No supported single-operator assignment or edge-triggered assignment was found.'
        }
      };
    }

    // Calculate only illustrative sums from an uncharacterized toy gate table.
    let totalArea = 0;
    let totalLeakage = 0;
    let serialGateDelayEstimate_ps = 0;

    for (const g of gates) {
      const cellInfo = STANDARD_CELL_LIB[g.cell];
      if (!cellInfo) throw new Error(`UNSUPPORTED: The toy gate table has no ${g.cell} record.`);
      totalArea += cellInfo.area_um2;
      totalLeakage += cellInfo.leakage_uW;
      serialGateDelayEstimate_ps += cellInfo.delay_ps;
    }

    const shouldComputeTiming = options.computeTiming === true || options.clockPeriod_ps !== undefined;
    let criticalPathDelay_ps = null;
    let timingSlack_ps = null;
    let maxFrequency_MHz = null;
    let timingObj = {
      status: 'unavailable',
      reason: 'No target clock, constraints, characterized library, or timing graph is configured.',
      serialGateDelayEstimate_ps: +serialGateDelayEstimate_ps.toFixed(1),
      criticalPathDelay_ps: null,
      timingSlack_ps: null,
      maxFrequency_MHz: null
    };

    if (shouldComputeTiming) {
      const netArrival_ps = {};
      for (const inNet of inputs) {
        netArrival_ps[inNet] = Number.isFinite(options.inputDelay_ps) ? options.inputDelay_ps : 0.0;
      }

      const remainingGates = [...gates];
      let progress = true;
      let passes = 0;
      const maxPasses = gates.length * 2 + 10;

      while (remainingGates.length > 0 && progress && passes < maxPasses) {
        progress = false;
        passes++;
        for (let i = remainingGates.length - 1; i >= 0; i--) {
          const g = remainingGates[i];
          const cellInfo = STANDARD_CELL_LIB[g.cell];
          if (g.cell === 'DFF') {
            netArrival_ps[g.output] = cellInfo.delay_ps;
            remainingGates.splice(i, 1);
            progress = true;
          } else {
            const inKeys = Object.keys(g.inputs || {});
            const allInputsReady = inKeys.every((k) => netArrival_ps[g.inputs[k]] !== undefined);
            if (allInputsReady) {
              const maxIn = inKeys.length > 0 ? Math.max(...inKeys.map((k) => netArrival_ps[g.inputs[k]])) : 0.0;
              netArrival_ps[g.output] = maxIn + cellInfo.delay_ps;
              remainingGates.splice(i, 1);
              progress = true;
            }
          }
        }
      }

      for (const g of remainingGates) {
        const cellInfo = STANDARD_CELL_LIB[g.cell];
        netArrival_ps[g.output] = cellInfo.delay_ps;
      }

      const endpointDelays = [];
      for (const outNet of outputs) {
        if (netArrival_ps[outNet] !== undefined) {
          endpointDelays.push(netArrival_ps[outNet]);
        }
      }
      for (const g of gates) {
        if (g.cell === 'DFF' && g.inputs?.D && netArrival_ps[g.inputs.D] !== undefined) {
          endpointDelays.push(netArrival_ps[g.inputs.D] + (STANDARD_CELL_LIB.DFF.setup_ps || 25.0));
        }
      }
      if (endpointDelays.length === 0) {
        for (const g of gates) {
          if (netArrival_ps[g.output] !== undefined) {
            endpointDelays.push(netArrival_ps[g.output]);
          }
        }
      }

      criticalPathDelay_ps = endpointDelays.length > 0 ? +Math.max(...endpointDelays).toFixed(2) : 0.0;
      const clockPeriod_ps = Number.isFinite(options.clockPeriod_ps) ? options.clockPeriod_ps : 1000.0;
      timingSlack_ps = +(clockPeriod_ps - criticalPathDelay_ps).toFixed(2);
      maxFrequency_MHz = criticalPathDelay_ps > 0 ? +(1e6 / criticalPathDelay_ps).toFixed(2) : null;

      timingObj = {
        status: 'computed-dag',
        clockPeriod_ps,
        serialGateDelayEstimate_ps: +serialGateDelayEstimate_ps.toFixed(1),
        criticalPathDelay_ps,
        timingSlack_ps,
        maxFrequency_MHz
      };
    }

    return {
      success: true,
      status: 'experimental-estimate',
      moduleName,
      inputs,
      outputs,
      gateCount: gates.length,
      gates,
      totalArea_um2: +totalArea.toFixed(2),
      totalLeakage_uW: +totalLeakage.toFixed(3),
      serialGateDelayEstimate_ps: +serialGateDelayEstimate_ps.toFixed(1),
      criticalPathDelay_ps,
      timingSlack_ps,
      maxFrequency_MHz,
      validationLevel: 'experimental',
      model: 'single-operator parser with standard cell timing graph',
      timing: timingObj,
      area: {
        status: 'illustrative-uncharacterized-estimate',
        totalArea_um2: +totalArea.toFixed(2),
        totalLeakage_uW: +totalLeakage.toFixed(3)
      },
      experimentalStatus: 'ESTIMATE_ONLY',
      warnings: ['Toy gate values are uncharacterized; area and leakage are illustrative only.']
    };
  }

  static _mapExpressionToGates(expr, targetOutput, gates) {
    const binaryOperators = ['&', '|', '^'].filter((operator) => expr.includes(operator));
    const identifier = /^[A-Za-z_][A-Za-z0-9_$]*$/;
    if (binaryOperators.length === 1 && expr.split(binaryOperators[0]).length === 2) {
      const tokens = expr.split(binaryOperators[0]).map((token) => token.trim());
      if (!tokens.every((token) => identifier.test(token))) {
        throw new Error('UNSUPPORTED: Boolean operands must be simple identifiers.');
      }
      const cell = { '&': 'AND2', '|': 'OR2', '^': 'XOR2' }[binaryOperators[0]];
      gates.push({
        id: `U_${gates.length + 1}`,
        cell,
        inputs: { A: tokens[0], B: tokens[1] },
        output: targetOutput
      });
    } else if (binaryOperators.length === 0 && expr.startsWith('~')) {
      const inNet = expr.slice(1).trim();
      if (!identifier.test(inNet)) throw new Error('UNSUPPORTED: Inversion requires a simple identifier operand.');
      gates.push({
        id: `U_${gates.length + 1}`,
        cell: 'INV',
        inputs: { A: inNet },
        output: targetOutput
      });
    } else {
      throw new Error('UNSUPPORTED: Only one &, |, ^, or unary ~ operator is supported per assignment.');
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LogicSynthesisEngine, STANDARD_CELL_LIB };
}
