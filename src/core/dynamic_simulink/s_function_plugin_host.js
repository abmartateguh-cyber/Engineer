/**
 * OmniEng Simulink Level-2 C / Wasm S-Function Plugin Host
 * 
 * Provides a standardized execution container for custom user algorithms,
 * legacy C/C++ MEX code, and WebAssembly compiled modules within OmniEng's
 * dynamic block diagram simulation runtime.
 * 
 * Implements the standard Simulink S-Function callback lifecycle:
 *   - mdlInitializeSizes: defines state vectors, port widths, sample times
 *   - mdlInitializeSampleTimes: sets continuous/discrete sample rates
 *   - mdlStart: block setup and initial conditions
 *   - mdlOutputs: evaluates y = f(t, x, u, p)
 *   - mdlUpdate: evaluates x_d[k+1] = g(t, x, u, p)
 *   - mdlDerivatives: evaluates dx_c/dt = h(t, x, u, p) for ODE solvers
 *   - mdlTerminate: resource cleanup
 * 
 * Unverified comparison target: MathWorks Simulink Level-2 C-MEX S-Function & Wasm Host.
 * 
 * Experimental implementation; release maturity and provenance are not established.
 */

'use strict';

class SFunctionPluginHost {
  /**
   * @param {Object} options
   * @param {string} [options.name='SFunctionBlock'] - S-Function block name
   * @param {Object} [options.parameters={}] - User-defined block parameters
   */
  constructor(options = {}) {
    this.name = options.name || 'SFunctionBlock';
    this.parameters = options.parameters || {};

    // Simulation structure (SimStruct equivalent)
    this.simStruct = {
      numContStates: 0,
      numDiscStates: 0,
      numInputs: 0,
      numOutputs: 0,
      directFeedthrough: true,
      sampleTime: 0.0, // 0.0 = continuous
      offsetTime: 0.0,
      userData: null
    };

    // State vectors
    this.continuousStates = [];
    this.discreteStates = [];
    this.derivatives = [];
    this.inputs = [];
    this.outputs = [];

    // Callbacks
    this.callbacks = {
      mdlInitializeSizes: null,
      mdlInitializeSampleTimes: null,
      mdlStart: null,
      mdlOutputs: null,
      mdlUpdate: null,
      mdlDerivatives: null,
      mdlTerminate: null
    };

    this.isInitialized = false;
    this.wasmInstance = null;
    this.executionLog = [];
  }

  /**
   * Registers a pure JavaScript or compiled S-Function definition.
   * 
   * @param {Object} blockDef
   * @param {Function} [blockDef.mdlInitializeSizes]
   * @param {Function} [blockDef.mdlInitializeSampleTimes]
   * @param {Function} [blockDef.mdlStart]
   * @param {Function} [blockDef.mdlOutputs]
   * @param {Function} [blockDef.mdlUpdate]
   * @param {Function} [blockDef.mdlDerivatives]
   * @param {Function} [blockDef.mdlTerminate]
   * @returns {SFunctionPluginHost} this
   */
  registerDefinition(blockDef) {
    if (!blockDef) throw new Error('Invalid S-Function definition');
    this.callbacks = {
      mdlInitializeSizes: blockDef.mdlInitializeSizes || null,
      mdlInitializeSampleTimes: blockDef.mdlInitializeSampleTimes || null,
      mdlStart: blockDef.mdlStart || null,
      mdlOutputs: blockDef.mdlOutputs || null,
      mdlUpdate: blockDef.mdlUpdate || null,
      mdlDerivatives: blockDef.mdlDerivatives || null,
      mdlTerminate: blockDef.mdlTerminate || null
    };
    return this;
  }

  /**
   * Loads a C / C-MEX style S-Function plugin definition.
   * @param {string} pluginName
   * @param {Object} blockDef
   * @returns {SFunctionPluginHost} this
   */
  loadCPlugin(pluginName, blockDef) {
    if (typeof pluginName === 'object' && !blockDef) {
      blockDef = pluginName;
      pluginName = 'CPlugin';
    }
    this.name = pluginName || this.name;
    return this.registerDefinition(blockDef);
  }

  /**
   * Loads a compiled WebAssembly S-Function binary module.
   * Expected Wasm exports: mdlInitializeSizes, mdlOutputs, mdlDerivatives, etc.
   * 
   * @param {Uint8Array|ArrayBuffer} wasmBytes
   * @param {Object} [importObject={}]
   * @returns {Promise<SFunctionPluginHost>}
   */
  async loadWasm(wasmBytes, importObject = {}) {
    const memory = new WebAssembly.Memory({ initial: 256, maximum: 512 });
    const defaultImports = {
      env: {
        memory,
        sin: Math.sin,
        cos: Math.cos,
        exp: Math.exp,
        log: Math.log,
        pow: Math.pow,
        sqrt: Math.sqrt,
        printLog: (val) => this.executionLog.push(val)
      },
      ...importObject
    };

    const module = await WebAssembly.compile(wasmBytes);
    this.wasmInstance = await WebAssembly.instantiate(module, defaultImports);
    const exp = this.wasmInstance.exports;

    this.registerDefinition({
      mdlInitializeSizes: (ss) => {
        if (exp.mdlInitializeSizes) exp.mdlInitializeSizes();
      },
      mdlOutputs: (ss, t) => {
        if (exp.mdlOutputs) exp.mdlOutputs(t);
      },
      mdlDerivatives: (ss, t) => {
        if (exp.mdlDerivatives) exp.mdlDerivatives(t);
      },
      mdlUpdate: (ss, t) => {
        if (exp.mdlUpdate) exp.mdlUpdate(t);
      },
      mdlTerminate: (ss) => {
        if (exp.mdlTerminate) exp.mdlTerminate();
      }
    });

    return this;
  }

  /**
   * Initializes the S-Function simulation structure and allocates buffers.
   */
  initialize() {
    if (typeof this.callbacks.mdlInitializeSizes === 'function') {
      this.callbacks.mdlInitializeSizes(this.simStruct, this.parameters);
    }

    if (typeof this.callbacks.mdlInitializeSampleTimes === 'function') {
      this.callbacks.mdlInitializeSampleTimes(this.simStruct);
    }

    // Allocate memory vectors, preserving any pre-set initial conditions
    const prevCont = this.continuousStates;
    const prevDisc = this.discreteStates;
    const prevInputs = this.inputs;

    const numCont = Math.max(this.simStruct.numContStates, prevCont ? prevCont.length : 0);
    const numDisc = Math.max(this.simStruct.numDiscStates, prevDisc ? prevDisc.length : 0);
    this.simStruct.numContStates = numCont;
    this.simStruct.numDiscStates = numDisc;

    this.continuousStates = new Float64Array(numCont);
    this.discreteStates = new Float64Array(numDisc);
    this.derivatives = new Float64Array(numCont);
    this.inputs = new Float64Array(this.simStruct.numInputs);
    this.outputs = new Float64Array(this.simStruct.numOutputs);

    if (prevCont) {
      for (let i = 0; i < Math.min(this.continuousStates.length, prevCont.length); i++) {
        this.continuousStates[i] = prevCont[i];
      }
    }
    if (prevDisc) {
      for (let i = 0; i < Math.min(this.discreteStates.length, prevDisc.length); i++) {
        this.discreteStates[i] = prevDisc[i];
      }
    }
    if (prevInputs) {
      for (let i = 0; i < Math.min(this.inputs.length, prevInputs.length); i++) {
        this.inputs[i] = prevInputs[i];
      }
    }

    if (typeof this.callbacks.mdlStart === 'function') {
      this.callbacks.mdlStart(this.simStruct, {
        continuousStates: this.continuousStates,
        discreteStates: this.discreteStates,
        parameters: this.parameters
      });
    }

    this.isInitialized = true;
  }

  /**
   * Sets continuous initial conditions.
   * @param {number[]|Float64Array} states
   */
  setContinuousStates(states) {
    if (!this.continuousStates || this.continuousStates.length < states.length) {
      this.continuousStates = new Float64Array(states);
      this.simStruct.numContStates = states.length;
    } else {
      for (let i = 0; i < Math.min(this.continuousStates.length, states.length); i++) {
        this.continuousStates[i] = states[i];
      }
    }
  }

  /**
   * Sets discrete initial conditions.
   * @param {number[]|Float64Array} states
   */
  setDiscreteStates(states) {
    if (!this.discreteStates || this.discreteStates.length < states.length) {
      this.discreteStates = new Float64Array(states);
      this.simStruct.numDiscStates = states.length;
    } else {
      for (let i = 0; i < Math.min(this.discreteStates.length, states.length); i++) {
        this.discreteStates[i] = states[i];
      }
    }
  }

  /**
   * Sets current input vector.
   * @param {number[]|Float64Array} inputs
   */
  setInputs(inputs) {
    for (let i = 0; i < Math.min(this.inputs.length, inputs.length); i++) {
      this.inputs[i] = inputs[i];
    }
  }

  /**
   * Evaluates block outputs at current time.
   * @param {number} time - Current simulation time (s)
   * @returns {Float64Array} Output values
   */
  evaluateOutputs(time) {
    if (!this.isInitialized) this.initialize();

    if (typeof this.callbacks.mdlOutputs === 'function') {
      this.callbacks.mdlOutputs(this.simStruct, time, {
        inputs: this.inputs,
        continuousStates: this.continuousStates,
        discreteStates: this.discreteStates,
        outputs: this.outputs,
        parameters: this.parameters
      });
    }
    return new Float64Array(this.outputs);
  }

  /**
   * Evaluates continuous state derivatives dx/dt.
   * @param {number} time - Current simulation time (s)
   * @returns {Float64Array} Derivatives vector
   */
  evaluateDerivatives(time) {
    if (!this.isInitialized) this.initialize();

    if (typeof this.callbacks.mdlDerivatives === 'function') {
      this.callbacks.mdlDerivatives(this.simStruct, time, {
        inputs: this.inputs,
        continuousStates: this.continuousStates,
        derivatives: this.derivatives,
        parameters: this.parameters
      });
    }
    return new Float64Array(this.derivatives);
  }

  /**
   * Updates discrete states x_d[k+1].
   * @param {number} time - Current simulation time (s)
   * @returns {Float64Array} Updated discrete states
   */
  updateDiscreteStates(time) {
    if (!this.isInitialized) this.initialize();

    if (typeof this.callbacks.mdlUpdate === 'function') {
      this.callbacks.mdlUpdate(this.simStruct, time, {
        inputs: this.inputs,
        continuousStates: this.continuousStates,
        discreteStates: this.discreteStates,
        parameters: this.parameters
      });
    }
    return new Float64Array(this.discreteStates);
  }

  /**
   * Integrates continuous states forward by dt using Runge-Kutta 4th order (RK4).
   * 
   * @param {number} time - Current time
   * @param {number} dt - Integration time step
   */
  stepContinuousRK4(time, dt) {
    const n = this.simStruct.numContStates;
    if (n === 0) return;

    const x0 = new Float64Array(this.continuousStates);

    // k1 = f(t, x0)
    const k1 = this.evaluateDerivatives(time);

    // k2 = f(t + dt/2, x0 + dt/2 * k1)
    for (let i = 0; i < n; i++) this.continuousStates[i] = x0[i] + 0.5 * dt * k1[i];
    const k2 = this.evaluateDerivatives(time + 0.5 * dt);

    // k3 = f(t + dt/2, x0 + dt/2 * k2)
    for (let i = 0; i < n; i++) this.continuousStates[i] = x0[i] + 0.5 * dt * k2[i];
    const k3 = this.evaluateDerivatives(time + 0.5 * dt);

    // k4 = f(t + dt, x0 + dt * k3)
    for (let i = 0; i < n; i++) this.continuousStates[i] = x0[i] + dt * k3[i];
    const k4 = this.evaluateDerivatives(time + dt);

    // Final RK4 update
    for (let i = 0; i < n; i++) {
      this.continuousStates[i] = x0[i] + (dt / 6.0) * (k1[i] + 2.0 * k2[i] + 2.0 * k3[i] + k4[i]);
    }
  }

  /**
   * Terminates the S-Function and cleans up.
   */
  terminate() {
    if (typeof this.callbacks.mdlTerminate === 'function') {
      this.callbacks.mdlTerminate(this.simStruct);
    }
    this.isInitialized = false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SFunctionPluginHost };
}
if (typeof window !== 'undefined') {
  window.SFunctionPluginHost = SFunctionPluginHost;
}
