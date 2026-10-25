/**
 * Experimental dynamic block-diagram execution engine.
 * Manages visual blocks, signal-routing wires, and continuous/discrete time updates.
 */

const MAX_SIMULATION_STEPS = 1_000_000;
const MAX_SIMULATION_WORK_UNITS = 10_000_000;
const MAX_RECORDED_VALUES = 2_000_000;

class BlockNode {
  constructor(id, type, name, params = {}, x = 100, y = 100) {
    this.id = id;
    this.type = type; // 'source_step', 'gain', 'sum', 'integrator', 'pid', 'transfer_function', 'scope'
    this.name = name || type;
    this.params = { ...params };
    this.x = x;
    this.y = y;
    this.state = 0.0; // internal integrator / filter state
    this.previousError = null;
    this.output = 0.0; // current time-step output value
    this.inputs = []; // incoming wire connections [{fromBlockId, fromPort, toPort}]
  }
}

class BlockDiagramGraph {
  constructor() {
    this.blocks = new Map();
    this.connections = []; // Array of { id, fromBlock, fromPort, toBlock, toPort }
    this.nextBlockId = 1;
    this.nextConnectionId = 1;
  }

  addBlock(type, name, params = {}, x = 100, y = 100) {
    const id = `blk_${String(this.nextBlockId++).padStart(6, '0')}`;
    const block = new BlockNode(id, type, name, params, x, y);
    this.blocks.set(id, block);
    return block;
  }

  removeBlock(blockId) {
    this.blocks.delete(blockId);
    this.connections = this.connections.filter((c) => c.fromBlock !== blockId && c.toBlock !== blockId);
  }

  connect(fromBlockId, toBlockId, fromPort = 0, toPort = 0) {
    const id = `wire_${String(this.nextConnectionId++).padStart(6, '0')}`;
    const conn = { id, fromBlock: fromBlockId, fromPort, toBlock: toBlockId, toPort };
    this.connections.push(conn);
    return conn;
  }

  disconnect(connectionId) {
    this.connections = this.connections.filter((c) => c.id !== connectionId);
  }

  /**
   * Run simulation over duration with fixed time-step dt
   * @param {number} tEnd Duration in seconds (e.g. 10.0s)
   * @param {number} dt Time step (e.g. 0.01s)
   */
  simulate(tEnd, dt) {
    if (!Number.isFinite(tEnd) || tEnd <= 0 || !Number.isFinite(dt) || dt <= 0) {
      throw new TypeError('BlockDiagramGraph.simulate requires positive finite tEnd and dt inputs.');
    }
    if (this.blocks.size === 0)
      throw new TypeError('BlockDiagramGraph.simulate requires at least one configured block.');
    const steps = Math.ceil(tEnd / dt);
    if (!Number.isSafeInteger(steps) || steps > MAX_SIMULATION_STEPS) {
      throw new RangeError('BlockDiagramGraph.simulate exceeds the 1,000,000-step work limit.');
    }
    const workUnits = steps * (this.blocks.size + this.connections.length);
    const recordedValues = (steps + 1) * (this.blocks.size + 1);
    if (workUnits > MAX_SIMULATION_WORK_UNITS || recordedValues > MAX_RECORDED_VALUES) {
      throw new RangeError('BlockDiagramGraph.simulate exceeds the graph work or result-size budget.');
    }

    const requiredParams = {
      source_step: ['stepTime', 'initialValue', 'finalValue'],
      source_sine: ['frequency', 'amplitude'],
      source_constant: ['value'],
      gain: ['k'],
      sum: [],
      integrator: ['initialState'],
      pid: ['kp', 'ki', 'kd', 'initialState'],
      scope: []
    };
    for (const block of this.blocks.values()) {
      if (!Object.hasOwn(requiredParams, block.type)) {
        throw new TypeError(`Unsupported block type '${block.type}'.`);
      }
      if (!block.params || typeof block.params !== 'object' || Array.isArray(block.params)) {
        throw new TypeError(`Block '${block.id}' requires a parameter object.`);
      }
      for (const name of requiredParams[block.type]) {
        if (!Object.hasOwn(block.params, name) || !Number.isFinite(block.params[name])) {
          throw new TypeError(`Block '${block.id}' (${block.type}) requires a finite '${name}' input.`);
        }
      }
    }
    const incomingConnections = new Map(Array.from(this.blocks.keys(), (id) => [id, []]));
    for (const connection of this.connections) {
      if (!this.blocks.has(connection.fromBlock) || !this.blocks.has(connection.toBlock)) {
        throw new TypeError(`Connection '${connection.id}' references a missing block.`);
      }
      incomingConnections.get(connection.toBlock).push(connection);
    }
    for (const block of this.blocks.values()) {
      if (!block.type.startsWith('source_') && incomingConnections.get(block.id).length === 0) {
        throw new TypeError(`Block '${block.id}' (${block.type}) requires at least one input connection.`);
      }
      if (
        block.type === 'pid' &&
        block.params.limitMin !== undefined &&
        block.params.limitMax !== undefined &&
        (!Number.isFinite(block.params.limitMin) ||
          !Number.isFinite(block.params.limitMax) ||
          block.params.limitMin > block.params.limitMax)
      ) {
        throw new TypeError(`Block '${block.id}' has invalid PID output limits.`);
      }
    }

    const evalOrder = this._getTopologicalOrder();
    const timeArray = [];
    const signalLog = new Map(); // blockId -> Array of output values

    for (const [id] of this.blocks) {
      signalLog.set(id, []);
    }

    // Reset block states
    for (const [, blk] of this.blocks) {
      blk.state = Number(blk.params.initialState ?? 0.0);
      blk.previousError = null;
      blk.output = 0.0;
    }

    for (let s = 0; s <= steps; s++) {
      const t = s * dt;
      timeArray.push(t);

      // Evaluate blocks in topological order
      for (const blk of evalOrder) {
        // Collect incoming signal values
        const inValues = [];
        const inConns = incomingConnections.get(blk.id);
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
            const stepTime = Number(blk.params.stepTime);
            const initialVal = Number(blk.params.initialValue);
            const finalVal = Number(blk.params.finalValue);
            blk.output = t >= stepTime ? finalVal : initialVal;
            break;
          }
          case 'source_sine': {
            const freq = Number(blk.params.frequency); // Hz
            const amp = Number(blk.params.amplitude);
            blk.output = amp * Math.sin(2 * Math.PI * freq * t);
            break;
          }
          case 'source_constant': {
            blk.output = Number(blk.params.value);
            break;
          }
          case 'gain': {
            const k = Number(blk.params.k);
            blk.output = k * u;
            break;
          }
          case 'sum': {
            // Sum all incoming inputs (with optional sign inverted)
            let sum = 0;
            inValues.forEach((val) => (sum += val));
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
            const Kp = Number(blk.params.kp);
            const Ki = Number(blk.params.ki);
            const Kd = Number(blk.params.kd);

            const err = u;
            const prevErr = blk.previousError === null ? err : blk.previousError;
            const derivative = dt > 0 ? (err - prevErr) / dt : 0;
            blk.previousError = err;

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

        if (!Number.isFinite(blk.output) || !Number.isFinite(blk.state)) {
          throw new RangeError(`Block '${blk.id}' produced a non-finite output or state at t=${t} s.`);
        }
        signalLog.get(blk.id).push(blk.output);
      }
    }

    return {
      t: timeArray,
      time: timeArray,
      signals: Object.fromEntries(signalLog)
    };
  }

  _getTopologicalOrder() {
    const indegree = new Map(Array.from(this.blocks.keys(), (id) => [id, 0]));
    const outgoing = new Map(Array.from(this.blocks.keys(), (id) => [id, []]));
    for (const connection of this.connections) {
      if (!indegree.has(connection.fromBlock) || !indegree.has(connection.toBlock)) {
        throw new TypeError(`Connection '${connection.id}' references a missing block.`);
      }
      outgoing.get(connection.fromBlock).push(connection.toBlock);
      indegree.set(connection.toBlock, indegree.get(connection.toBlock) + 1);
    }

    const ready = Array.from(indegree.keys()).filter((id) => indegree.get(id) === 0);
    const ordered = [];
    let nextReady = 0;
    while (nextReady < ready.length) {
      const id = ready[nextReady++];
      ordered.push(this.blocks.get(id));
      for (const targetId of outgoing.get(id)) {
        const nextDegree = indegree.get(targetId) - 1;
        indegree.set(targetId, nextDegree);
        if (nextDegree === 0) ready.push(targetId);
      }
    }

    if (ordered.length !== this.blocks.size) {
      throw new Error('BlockDiagramGraph feedback loops are unsupported; only acyclic signal graphs can run.');
    }
    return ordered;
  }

  toJSON() {
    return {
      blocks: Array.from(this.blocks.values()).map((b) => ({
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
