/**
 * OmniEng Dynamic Block-Diagram Execution Engine (MATLAB / Simulink Equivalent)
 * Manages visual blocks, signal routing wires, and continuous/discrete time updates.
 */

class BlockNode {
  constructor(id, type, name, params = {}, x = 100, y = 100) {
    this.id = id;
    this.type = type; // 'source_step', 'gain', 'sum', 'integrator', 'pid', 'transfer_function', 'scope'
    this.name = name || type;
    this.params = { ...params };
    this.x = x;
    this.y = y;
    this.state = 0.0;     // internal integrator / filter state
    this.output = 0.0;    // current time-step output value
    this.inputs = [];     // incoming wire connections [{fromBlockId, fromPort, toPort}]
  }
}

class BlockDiagramGraph {
  constructor() {
    this.blocks = new Map();
    this.connections = []; // Array of { id, fromBlock, fromPort, toBlock, toPort }
  }

  addBlock(type, name, params = {}, x = 100, y = 100) {
    const id = 'blk_' + Math.random().toString(36).substr(2, 8);
    const block = new BlockNode(id, type, name, params, x, y);
    this.blocks.set(id, block);
    return block;
  }

  removeBlock(blockId) {
    this.blocks.delete(blockId);
    this.connections = this.connections.filter(
      c => c.fromBlock !== blockId && c.toBlock !== blockId
    );
  }

  connect(fromBlockId, toBlockId, fromPort = 0, toPort = 0) {
    const id = 'wire_' + Math.random().toString(36).substr(2, 8);
    const conn = { id, fromBlock: fromBlockId, fromPort, toBlock: toBlockId, toPort };
    this.connections.push(conn);
    return conn;
  }

  disconnect(connectionId) {
    this.connections = this.connections.filter(c => c.id !== connectionId);
  }

  /**
   * Run simulation over duration with fixed time-step dt
   * @param {number} tEnd Duration in seconds (e.g. 10.0s)
   * @param {number} dt Time step (e.g. 0.01s)
   */
  simulate(tEnd = 10.0, dt = 0.01) {
    const steps = Math.ceil(tEnd / dt);
    const timeArray = [];
    const signalLog = new Map(); // blockId -> Array of output values

    for (const [id] of this.blocks) {
      signalLog.set(id, []);
    }

    // Reset block states
    for (const [, blk] of this.blocks) {
      blk.state = Number(blk.params.initialState || 0.0);
      blk.output = 0.0;
    }

    // Topological sort blocks to determine evaluation order
    const evalOrder = this._getTopologicalOrder();

    for (let s = 0; s <= steps; s++) {
      const t = +(s * dt).toFixed(4);
      timeArray.push(t);

      // Evaluate blocks in topological order
      for (const blk of evalOrder) {
        // Collect incoming signal values
        const inValues = [];
        const inConns = this.connections.filter(c => c.toBlock === blk.id);
        for (const conn of inConns) {
          const srcBlock = this.blocks.get(conn.fromBlock);
          if (srcBlock) {
            inValues.push(srcBlock.output);
          }
        }

        const u = inValues.length > 0 ? inValues[0] : 0.0;

        // Block transfer function update
        switch (blk.type) {
          case 'source_step': {
            const stepTime = Number(blk.params.stepTime || 1.0);
            const initialVal = Number(blk.params.initialValue || 0.0);
            const finalVal = Number(blk.params.finalValue || 1.0);
            blk.output = t >= stepTime ? finalVal : initialVal;
            break;
          }
          case 'source_sine': {
            const freq = Number(blk.params.frequency || 1.0); // Hz
            const amp = Number(blk.params.amplitude || 1.0);
            blk.output = amp * Math.sin(2 * Math.PI * freq * t);
            break;
          }
          case 'source_constant': {
            blk.output = Number(blk.params.value || 1.0);
            break;
          }
          case 'gain': {
            const k = Number(blk.params.k || 1.0);
            blk.output = k * u;
            break;
          }
          case 'sum': {
            // Sum all incoming inputs (with optional sign inverted)
            let sum = 0;
            inValues.forEach(val => sum += val);
            blk.output = sum;
            break;
          }
          case 'integrator': {
            // Forward Euler integration: y = state, next_state = state + dt * u
            blk.output = blk.state;
            blk.state += dt * u;
            break;
          }
          case 'pid': {
            // PID Controller: u_pid = Kp*e + Ki*integral(e) + Kd*de/dt
            const Kp = Number(blk.params.kp || 2.0);
            const Ki = Number(blk.params.ki || 0.5);
            const Kd = Number(blk.params.kd || 0.1);

            const err = u;
            const prevErr = blk.params._prevErr !== undefined ? blk.params._prevErr : err;
            const derivative = dt > 0 ? (err - prevErr) / dt : 0;
            blk.params._prevErr = err;

            blk.state += dt * err; // integral accumulator
            let out = Kp * err + Ki * blk.state + Kd * derivative;

            // Optional saturation
            if (blk.params.limitMax !== undefined) out = Math.min(out, Number(blk.params.limitMax));
            if (blk.params.limitMin !== undefined) out = Math.max(out, Number(blk.params.limitMin));

            blk.output = out;
            break;
          }
          case 'scope': {
            blk.output = u;
            break;
          }
          default:
            blk.output = u;
            break;
        }

        signalLog.get(blk.id).push(+blk.output.toFixed(4));
      }
    }

    return {
      t: timeArray,
      time: timeArray,
      signals: Object.fromEntries(signalLog)
    };
  }

  _getTopologicalOrder() {
    // Return block nodes in topological dependency order
    const list = Array.from(this.blocks.values());
    list.sort((a, b) => {
      // Sources first, integrators and scopes later
      if (a.type.startsWith('source_')) return -1;
      if (b.type.startsWith('source_')) return 1;
      if (a.type === 'scope') return 1;
      if (b.type === 'scope') return -1;
      return a.x - b.x;
    });
    return list;
  }

  toJSON() {
    return {
      blocks: Array.from(this.blocks.values()).map(b => ({
        id: b.id,
        type: b.type,
        name: b.name,
        params: b.params,
        x: b.x,
        y: b.y
      })),
      connections: this.connections
    };
  }

  static fromJSON(data) {
    const graph = new BlockDiagramGraph();
    if (data && data.blocks) {
      for (const b of data.blocks) {
        const blk = new BlockNode(b.id, b.type, b.name, b.params, b.x, b.y);
        graph.blocks.set(b.id, blk);
      }
    }
    if (data && data.connections) {
      graph.connections = [...data.connections];
    }
    return graph;
  }
}

const { StateSpaceEngine } = require('./state_space_engine');
const { ExtendedKalmanFilter } = require('./extended_kalman_filter');
const { AerodynamicCoefficients } = require('./aerodynamic_coefficients');

BlockDiagramGraph.StateSpace = StateSpaceEngine;
BlockDiagramGraph.EKF = ExtendedKalmanFilter;
BlockDiagramGraph.Aero = AerodynamicCoefficients;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { 
    BlockNode, 
    BlockDiagramGraph,
    StateSpaceEngine,
    ExtendedKalmanFilter,
    AerodynamicCoefficients
  };
}
