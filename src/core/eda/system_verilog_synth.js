/**
 * Experimental SystemVerilog declaration inspection and standalone AIG operations.
 * This module does not elaborate RTL expressions, synthesize a netlist, or map cells.
 */

class AIGNode {
  constructor(id, type = 'AND', input1 = null, inv1 = false, input2 = null, inv2 = false) {
    this.id = id;
    this.type = type; // 'AND', 'PI' (Primary Input), 'CONST'
    this.input1 = input1;
    this.inv1 = inv1;
    this.input2 = input2;
    this.inv2 = inv2;
  }
}

class AndInverterGraph {
  constructor() {
    this.nodes = [];
    this.inputs = new Map(); // name -> AIGNode
    this.outputs = new Map(); // name -> { node: AIGNode, inverted: boolean }
    this.const0 = this._createNode('CONST');
  }

  _createNode(type, input1 = null, inv1 = false, input2 = null, inv2 = false) {
    const node = new AIGNode(this.nodes.length, type, input1, inv1, input2, inv2);
    this.nodes.push(node);
    return node;
  }

  addPrimaryInput(name) {
    const node = this._createNode('PI');
    this.inputs.set(name, node);
    return node;
  }

  addAnd(node1, inv1, node2, inv2) {
    // Constant folding
    if (node1.type === 'CONST' && !inv1) return this.const0; // 0 AND x = 0
    if (node2.type === 'CONST' && !inv2) return this.const0;
    if (node1.type === 'CONST' && inv1) return { node: node2, inv: inv2 }; // 1 AND x = x
    if (node2.type === 'CONST' && inv2) return { node: node1, inv: inv1 };

    // Idempotency: x AND x = x
    if (node1.id === node2.id && inv1 === inv2) {
      return { node: node1, inv: inv1 };
    }
    // Complementarity: x AND !x = 0
    if (node1.id === node2.id && inv1 !== inv2) {
      return this.const0;
    }

    const node = this._createNode('AND', node1, inv1, node2, inv2);
    return { node, inv: false };
  }

  addOr(node1, inv1, node2, inv2) {
    // De Morgan's Law: A OR B = !(!A AND !B)
    const andRes = this.addAnd(node1, !inv1, node2, !inv2);
    const targetNode = andRes.node || andRes;
    const targetInv = andRes.inv !== undefined ? !andRes.inv : true;
    return { node: targetNode, inv: targetInv };
  }

  addXor(node1, inv1, node2, inv2) {
    // A XOR B = (A AND !B) OR (!A AND B)
    const term1 = this.addAnd(node1, inv1, node2, !inv2);
    const term2 = this.addAnd(node1, !inv1, node2, inv2);
    return this.addOr(term1.node || term1, term1.inv || false, term2.node || term2, term2.inv || false);
  }

  setPrimaryOutput(name, node, inverted = false) {
    this.outputs.set(name, { node, inverted });
  }
}

const UNAVAILABLE_LIBRARY = Object.freeze({
  available: false,
  status: 'unavailable',
  cells: Object.freeze({})
});

class SystemVerilogSynthesizer {
  constructor() {
    this.lib = UNAVAILABLE_LIBRARY;
    this.aig = new AndInverterGraph();
  }

  /**
   * Inspects a limited subset of declarations in SystemVerilog source.
   * Expression elaboration and technology mapping are unavailable.
   */
  synthesize(svSourceCode) {
    if (typeof svSourceCode !== 'string') {
      throw new TypeError('SystemVerilog source must be a string.');
    }
    const source = svSourceCode.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const moduleMatch = source.match(/\bmodule\s+([a-zA-Z0-9_]+)/);
    const moduleName = moduleMatch ? moduleMatch[1] : null;
    if (!moduleName) throw new TypeError('A SystemVerilog module declaration is required.');

    // Parse parameters
    const params = new Map();
    const paramRegex = /parameter\s+([a-zA-Z0-9_]+)\s*=\s*([0-9]+)/g;
    let pMatch;
    while ((pMatch = paramRegex.exec(source)) !== null) {
      params.set(pMatch[1], parseInt(pMatch[2], 10));
    }

    // Detect primary inputs and outputs
    const inputs = [];
    const outputs = [];

    const portLines = source.split(';');
    for (const line of portLines) {
      const clean = line.trim();
      if (clean.includes('input')) {
        const match = clean.match(/input\s+(?:logic\s+)?(?:\[.*?\]\s*)?([a-zA-Z0-9_,\s]+)/);
        if (match) {
          const names = match[1].split(',').map((s) => s.trim());
          inputs.push(...names);
        }
      } else if (clean.includes('output')) {
        const match = clean.match(/output\s+(?:logic\s+)?(?:\[.*?\]\s*)?([a-zA-Z0-9_,\s]+)/);
        if (match) {
          const names = match[1].split(',').map((s) => s.trim());
          outputs.push(...names);
        }
      }
    }

    // Report only the presence of sequential syntax; this is not AST elaboration.
    const isSequential = source.includes('always_ff') || source.includes('posedge clk');
    return {
      moduleName,
      analysisStatus: 'experimental-partial',
      parameters: Object.fromEntries(params),
      ports: {
        inputs,
        outputs
      },
      sequentialSyntaxDetected: isSequential,
      aigMetrics: {
        status: 'unavailable',
        reason: 'RTL expressions are not elaborated into an AIG.'
      },
      technologyMapping: {
        status: 'unavailable',
        targetLibrary: null,
        reason: 'RTL synthesis and Liberty technology mapping are not implemented.'
      },
      registers: {
        status: 'unavailable',
        reason: 'Sequential declarations are not elaborated into register records.'
      }
    };
  }
}

module.exports = {
  AIGNode,
  AndInverterGraph,
  // Legacy export names remain as explicit unavailable sentinels for API compatibility.
  LIBERTY_LIBRARY: UNAVAILABLE_LIBRARY,
  SystemVerilogSynthesizer,
  // IPC and testing aliases
  SystemVerilogElaborator: {
    elaborate: (code) => new SystemVerilogSynthesizer().synthesize(code)
  },
  AIGGraph: AndInverterGraph,
  TechnologyMapper: {
    mapToLiberty: () => ({
      status: 'unavailable',
      reason: 'Liberty cell mapping is not implemented.'
    })
  },
  SKY130_STANDARD_CELLS: UNAVAILABLE_LIBRARY
};
