/**
 * OmniEng GNC, Robotics & Controls Domain IPC Router & Schema Definitions
 * Covers Flight Dynamics, Block Diagrams, Bode, Multi-Rate, LQR, Autocoding, MPC, Simscape, MC/DC, FMI
 */

'use strict';

const { defineHandler } = require('./define_handler');
const { BlockDiagramGraph } = require('../../core/dynamic_simulink/block_graph');
const { FrequencyResponseAnalyzer } = require('../../core/dynamic_simulink/frequency_analysis');
const { ModernControlSynthesis } = require('../../core/dynamic_simulink/multi_rate_scheduler');
const { AutocoderCRust } = require('../../core/dynamic_simulink/autocoder_c_rust');
const { ModelPredictiveController } = require('../../core/dynamic_simulink/model_predictive_control');
const { SimscapeDAESolver } = require('../../core/dynamic_simulink/simscape_dae_solver');
function unavailableControlRoute(message) {
  return {
    success: false,
    status: 'unavailable',
    validationLevel: 'experimental',
    error: { code: 'UNSUPPORTED', message }
  };
}

const MATRIX_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: 100,
  items: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'number' } }
};
const VECTOR_SCHEMA = { type: 'array', minItems: 1, maxItems: 100, items: { type: 'number' } };
const fixedUnitSchema = (unit, dimension) => ({
  type: 'object',
  required: ['unit', 'dimension'],
  additionalProperties: false,
  properties: {
    unit: { type: 'string', enum: [unit] },
    dimension: { type: 'string', enum: [dimension] }
  }
});
const DIMENSIONLESS_SIGNAL_GRAPH_UNITS_SCHEMA = {
  type: 'object',
  required: ['tEnd', 'dt', 'signal', 'stepTime', 'sourceFrequency', 'gain', 'pid', 'layout'],
  additionalProperties: false,
  properties: {
    tEnd: fixedUnitSchema('s', 'time'),
    dt: fixedUnitSchema('s', 'time'),
    signal: fixedUnitSchema('1', 'dimensionless'),
    stepTime: fixedUnitSchema('s', 'time'),
    sourceFrequency: fixedUnitSchema('Hz', 'frequency'),
    gain: fixedUnitSchema('1', 'dimensionless'),
    pid: {
      type: 'object',
      required: ['kp', 'ki', 'kd', 'initialState', 'limits'],
      additionalProperties: false,
      properties: {
        kp: fixedUnitSchema('1', 'dimensionless'),
        ki: fixedUnitSchema('s^-1', 'frequency'),
        kd: fixedUnitSchema('s', 'time'),
        initialState: fixedUnitSchema('s', 'time'),
        limits: fixedUnitSchema('1', 'dimensionless')
      }
    },
    layout: fixedUnitSchema('px', 'display-coordinate')
  }
};
const BLOCK_DIAGRAM_TYPES = ['source_step', 'source_sine', 'source_constant', 'gain', 'sum', 'pid', 'scope'];
const BLOCK_DIAGRAM_PARAMETER_FIELDS = {
  source_step: {
    required: ['stepTime', 'initialValue', 'finalValue'],
    allowed: ['stepTime', 'initialValue', 'finalValue']
  },
  source_sine: { required: ['frequency', 'amplitude'], allowed: ['frequency', 'amplitude'] },
  source_constant: { required: ['value'], allowed: ['value'] },
  gain: { required: ['k'], allowed: ['k'] },
  sum: { required: [], allowed: [] },
  pid: {
    required: ['kp', 'ki', 'kd', 'initialState'],
    allowed: ['kp', 'ki', 'kd', 'initialState', 'limitMin', 'limitMax']
  },
  scope: { required: [], allowed: [] }
};
const BLOCK_DIAGRAM_BLOCK_SCHEMA = {
  type: 'object',
  required: ['id', 'type', 'params'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 128 },
    type: { type: 'string', enum: BLOCK_DIAGRAM_TYPES },
    name: { type: 'string', maxLength: 160 },
    params: { type: 'object' },
    x: { type: 'number' },
    y: { type: 'number' }
  }
};
const BLOCK_DIAGRAM_CONNECTION_SCHEMA = {
  type: 'object',
  required: ['fromBlock', 'toBlock'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 128 },
    fromBlock: { type: 'string', maxLength: 128 },
    fromPort: { type: 'number', integer: true, min: 0, max: 0 },
    toBlock: { type: 'string', maxLength: 128 },
    toPort: { type: 'number', integer: true, min: 0, max: 0 }
  }
};
const BLOCK_DIAGRAM_REQUEST_SCHEMA = {
  type: 'object',
  required: ['graphData', 'tEnd', 'dt', 'units'],
  additionalProperties: false,
  properties: {
    graphData: {
      type: 'object',
      required: ['blocks', 'connections'],
      additionalProperties: false,
      properties: {
        blocks: { type: 'array', minItems: 1, maxItems: 1000, items: BLOCK_DIAGRAM_BLOCK_SCHEMA },
        connections: { type: 'array', maxItems: 10000, items: BLOCK_DIAGRAM_CONNECTION_SCHEMA }
      }
    },
    tEnd: { type: 'number', min: 0.000001, max: 1000000 },
    dt: { type: 'number', min: 0.000001, max: 1000000 },
    units: DIMENSIONLESS_SIGNAL_GRAPH_UNITS_SCHEMA
  }
};

function validateBlockDiagramGraph(graphData) {
  if (!graphData || typeof graphData !== 'object' || Array.isArray(graphData)) {
    throw new TypeError('Caller-supplied graphData must be an object.');
  }
  const unexpectedGraphFields = Object.keys(graphData).filter((key) => !['blocks', 'connections'].includes(key));
  if (unexpectedGraphFields.length) {
    throw new TypeError(`Unexpected graphData properties: ${unexpectedGraphFields.join(', ')}.`);
  }
  if (!Array.isArray(graphData.blocks) || graphData.blocks.length < 1 || graphData.blocks.length > 1000) {
    throw new TypeError('Block graph requires between 1 and 1,000 blocks.');
  }
  if (!Array.isArray(graphData.connections) || graphData.connections.length > 10000) {
    throw new TypeError('Block graph requires a connections array with at most 10,000 entries.');
  }

  const ids = new Set();
  for (let index = 0; index < graphData.blocks.length; index++) {
    const block = graphData.blocks[index];
    const fields = block && BLOCK_DIAGRAM_PARAMETER_FIELDS[block.type];
    if (!block || typeof block !== 'object' || Array.isArray(block) || !fields) {
      throw new TypeError(`Block ${index + 1} has an unsupported shape or type.`);
    }
    if (Object.keys(block).some((key) => !['id', 'type', 'name', 'params', 'x', 'y'].includes(key))) {
      throw new TypeError(`Block '${block.id}' has an unexpected property.`);
    }
    if (typeof block.id !== 'string' || block.id.length < 1 || block.id.length > 128 || ids.has(block.id)) {
      throw new TypeError(`Block ${index + 1} requires a unique ID of 1 to 128 characters.`);
    }
    if (block.name !== undefined && (typeof block.name !== 'string' || block.name.length > 160)) {
      throw new TypeError(`Block '${block.id}' name must be a string of at most 160 characters.`);
    }
    if ((block.x !== undefined && !Number.isFinite(block.x)) || (block.y !== undefined && !Number.isFinite(block.y))) {
      throw new TypeError(`Block '${block.id}' layout coordinates must be finite pixels.`);
    }
    if (!block.params || typeof block.params !== 'object' || Array.isArray(block.params)) {
      throw new TypeError(`Block '${block.id}' requires a parameter object.`);
    }
    if (Object.keys(block.params).some((key) => !fields.allowed.includes(key))) {
      throw new TypeError(`Block '${block.id}' has an unsupported parameter for type '${block.type}'.`);
    }
    for (const name of fields.required) {
      if (!Object.hasOwn(block.params, name) || !Number.isFinite(block.params[name])) {
        throw new TypeError(`Block '${block.id}' (${block.type}) requires a finite '${name}' input.`);
      }
    }
    for (const [name, value] of Object.entries(block.params)) {
      if (!Number.isFinite(value)) throw new TypeError(`Block '${block.id}' parameter '${name}' must be finite.`);
    }
    if (
      block.type === 'pid' &&
      block.params.limitMin !== undefined &&
      block.params.limitMax !== undefined &&
      block.params.limitMin > block.params.limitMax
    ) {
      throw new TypeError(`Block '${block.id}' has invalid PID output limits.`);
    }
    ids.add(block.id);
  }

  for (let index = 0; index < graphData.connections.length; index++) {
    const connection = graphData.connections[index];
    if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
      throw new TypeError(`Connection ${index + 1} must be an object.`);
    }
    if (Object.keys(connection).some((key) => !['id', 'fromBlock', 'fromPort', 'toBlock', 'toPort'].includes(key))) {
      throw new TypeError(`Connection ${index + 1} has an unexpected property.`);
    }
    if (!ids.has(connection.fromBlock) || !ids.has(connection.toBlock)) {
      throw new TypeError(`Connection ${index + 1} references an unknown block ID.`);
    }
    for (const portName of ['fromPort', 'toPort']) {
      if (connection[portName] !== undefined && connection[portName] !== 0) {
        throw new TypeError(`Connection ${index + 1} uses an unsupported ${portName}; only port 0 is available.`);
      }
    }
  }
  return true;
}

function runBlockDiagramSimulation({ graphData, tEnd, dt }) {
  validateBlockDiagramGraph(graphData);
  const graph = BlockDiagramGraph.fromJSON(graphData);
  return {
    status: 'experimental',
    validationLevel: 'experimental',
    units: {
      time: { unit: 's', dimension: 'time' },
      signal: { unit: '1', dimension: 'dimensionless' }
    },
    ...graph.simulate(tEnd, dt)
  };
}

function registerControlsIpc() {
  // 1. Legacy propeller estimate, unavailable pending independent validation
  defineHandler(
    'omni:solve-propeller',
    {
      type: 'object',
      optional: true
    },
    async () => ({
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message:
          'Propeller performance is unavailable until a sourced propeller model and independent reference are reviewed.'
      }
    }),
    {
      domain: 'controls',
      description: 'Unavailable legacy propeller estimate; no independent validation is established'
    }
  );

  // 2. Legacy drone flight estimate, unavailable pending independent validation
  defineHandler(
    'omni:simulate-drone',
    {
      type: 'object',
      optional: true
    },
    async () => ({
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message:
          'Flight simulation is unavailable until vehicle parameters, model assumptions, and independent reference data are reviewed.'
      }
    }),
    {
      domain: 'controls',
      description: 'Unavailable legacy drone flight estimate; no independent validation is established'
    }
  );

  // 3. Block Diagram Graph Simulation
  defineHandler(
    'omni:simulate-block-diagram',
    BLOCK_DIAGRAM_REQUEST_SCHEMA,
    async (event, params) => runBlockDiagramSimulation(params),
    {
      domain: 'controls',
      description:
        'Experimental integration of caller-supplied dimensionless signals with explicit seconds for time controls'
    }
  );

  // 4. Bode Frequency Response Analysis
  defineHandler(
    'omni:solve-bode',
    {
      type: 'object',
      required: ['numCoeffs', 'denCoeffs', 'omegaMin', 'omegaMax', 'points'],
      additionalProperties: false,
      properties: {
        numCoeffs: VECTOR_SCHEMA,
        denCoeffs: VECTOR_SCHEMA,
        omegaMin: { type: 'number', min: 0 },
        omegaMax: { type: 'number', min: 0 },
        points: { type: 'number', integer: true, min: 2, max: 10000 }
      }
    },
    async (event, { numCoeffs, denCoeffs, omegaMin, omegaMax, points }) => {
      return FrequencyResponseAnalyzer.computeBode(numCoeffs, denCoeffs, omegaMin, omegaMax, points);
    },
    {
      domain: 'controls',
      description:
        'Compute an experimental Bode response from explicit transfer-function coefficients and frequency controls'
    }
  );

  // 5. Deterministic Multi-Rate Scheduler
  defineHandler(
    'omni:schedule-multi-rate',
    { type: 'object', optional: true },
    async () =>
      unavailableControlRoute(
        'A caller-supplied task model and serializable step contract are required. The legacy route does not create fixed sample tasks.'
      ),
    {
      domain: 'controls',
      description: 'Unavailable until a caller-supplied multi-rate task model contract is configured'
    }
  );

  // 6. Algebraic Loop Broyden Solver
  defineHandler(
    'omni:solve-algebraic-loop',
    { type: 'object', optional: true },
    async () =>
      unavailableControlRoute(
        'A caller-supplied algebraic system is required. The legacy route does not solve a built-in example equation.'
      ),
    {
      domain: 'controls',
      description: 'Unavailable until a serializable caller-supplied algebraic system contract is configured'
    }
  );

  // 7. Modern Control Synthesis (LQR)
  defineHandler(
    'omni:synthesize-lqr',
    {
      type: 'object',
      required: ['A', 'B', 'Q', 'R', 'maxIter', 'tolerance'],
      additionalProperties: false,
      properties: {
        A: MATRIX_SCHEMA,
        B: MATRIX_SCHEMA,
        Q: MATRIX_SCHEMA,
        R: MATRIX_SCHEMA,
        maxIter: { type: 'number', integer: true, min: 1, max: 10000 },
        tolerance: { type: 'number', min: 0 }
      }
    },
    async (event, { A, B, Q, R, maxIter, tolerance }) => {
      const cLqr = ModernControlSynthesis.solveContinuousLQR(A, B, Q, R, maxIter, tolerance);
      return { success: true, validationLevel: 'experimental', continuous: cLqr };
    },
    {
      domain: 'controls',
      description: 'Solve an experimental continuous-time LQR estimate from explicit A, B, Q, and R matrices'
    }
  );

  // 8. MISRA-C & #![no_std] Rust Autocoder
  defineHandler(
    'omni:autocode-controller',
    {
      type: 'object',
      required: ['modelSpec'],
      additionalProperties: false,
      properties: {
        modelSpec: {
          type: 'object',
          required: ['name', 'A', 'B', 'C', 'K', 'sampleRateHz'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', maxLength: 64 },
            A: MATRIX_SCHEMA,
            B: MATRIX_SCHEMA,
            C: MATRIX_SCHEMA,
            K: MATRIX_SCHEMA,
            sampleRateHz: { type: 'number', min: 0 },
            standard: { type: 'string', maxLength: 64 }
          }
        }
      }
    },
    async (event, { modelSpec: spec }) => {
      const cCode = AutocoderCRust.generateMisraC(spec);
      const rustCode = AutocoderCRust.generateNoStdRust(spec);
      const autosar = AutocoderCRust.generateAutosarSWC(spec);
      return { success: true, validationLevel: 'experimental', cCode, rustCode, autosar };
    },
    {
      domain: 'controls',
      description: 'Generate experimental C and Rust code; no MISRA or safety qualification is claimed'
    }
  );

  // 9. Model Predictive Control (MPC) QP
  defineHandler(
    'omni:solve-mpc',
    {
      type: 'object',
      required: ['options', 'x0', 'yRef'],
      additionalProperties: false,
      properties: {
        options: {
          type: 'object',
          required: [
            'A',
            'B',
            'C',
            'predictionHorizon',
            'controlHorizon',
            'Q',
            'R',
            'Rdelta',
            'uMin',
            'uMax',
            'deltaUMax',
            'initialControl'
          ],
          additionalProperties: false,
          properties: {
            A: MATRIX_SCHEMA,
            B: MATRIX_SCHEMA,
            C: MATRIX_SCHEMA,
            predictionHorizon: { type: 'number', integer: true, min: 1, max: 100 },
            controlHorizon: { type: 'number', integer: true, min: 1, max: 100 },
            Q: VECTOR_SCHEMA,
            R: VECTOR_SCHEMA,
            Rdelta: VECTOR_SCHEMA,
            uMin: VECTOR_SCHEMA,
            uMax: VECTOR_SCHEMA,
            deltaUMax: VECTOR_SCHEMA,
            initialControl: VECTOR_SCHEMA
          }
        },
        x0: VECTOR_SCHEMA,
        yRef: {}
      }
    },
    async (event, { options, x0, yRef }) => {
      const mpc = new ModelPredictiveController(options);
      const result = mpc.computeControlAction(x0, yRef);
      return { success: true, validationLevel: 'experimental', result };
    },
    {
      domain: 'controls',
      description:
        'Solve an experimental MPC estimate from explicit system, weight, constraint, state, and reference inputs'
    }
  );

  // 10. Simscape DAE Multiphysics Network
  defineHandler(
    'omni:simulate-simscape-dae',
    {
      type: 'object',
      required: [
        'R',
        'L',
        'Kt',
        'Ke',
        'J',
        'b',
        'V_step',
        'totalTimeSec',
        'dt',
        'initialCurrentAmps',
        'initialAngularVelocityRadS'
      ],
      additionalProperties: false,
      properties: {
        R: { type: 'number', min: 0 },
        L: { type: 'number', min: 0 },
        Kt: { type: 'number', min: 0 },
        Ke: { type: 'number', min: 0 },
        J: { type: 'number', min: 0 },
        b: { type: 'number', min: 0 },
        V_step: { type: 'number' },
        totalTimeSec: { type: 'number', min: 0 },
        dt: { type: 'number', min: 0 },
        initialCurrentAmps: { type: 'number' },
        initialAngularVelocityRadS: { type: 'number' }
      }
    },
    async (event, params) => {
      const result = SimscapeDAESolver.simulateElectromechanicalDCMotor(params);
      return { success: true, validationLevel: 'experimental', result };
    },
    {
      domain: 'controls',
      description:
        'Experimental linear DC motor estimate from explicit electrical, mechanical, initial-state, and time inputs'
    }
  );

  // 11. Experimental MC/DC pair diagnostic
  defineHandler(
    'omni:evaluate-mcdc-coverage',
    { type: 'object', optional: true },
    async () =>
      unavailableControlRoute(
        'The coverage engine requires caller-supplied decision logic, which this IPC contract cannot serialize. No built-in decision or test vectors were evaluated.'
      ),
    { domain: 'controls', description: 'Unavailable until a caller-supplied decision-logic contract is configured' }
  );

  // 12. FMI 2.0 Co-Simulation Master
  defineHandler(
    'omni:run-fmi-cosimulation',
    { type: 'object', optional: true },
    async () =>
      unavailableControlRoute(
        'Caller-supplied FMU artifacts and a connection map are required. The legacy route does not create placeholder FMUs.'
      ),
    { domain: 'controls', description: 'Unavailable until FMU artifact and connection contracts are configured' }
  );

  // 13. AUTOSAR Classic 4.4 SWC & ARXML Descriptor Generator
  defineHandler(
    'omni:generate-autosar-swc',
    {
      type: 'object',
      required: ['modelSpec'],
      additionalProperties: false,
      properties: {
        modelSpec: {
          type: 'object',
          required: ['name', 'A', 'B', 'C', 'K', 'sampleRateHz'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', maxLength: 64 },
            A: MATRIX_SCHEMA,
            B: MATRIX_SCHEMA,
            C: MATRIX_SCHEMA,
            K: MATRIX_SCHEMA,
            sampleRateHz: { type: 'number', min: 0 },
            standard: { type: 'string', maxLength: 64 }
          }
        }
      }
    },
    async (event, { modelSpec: spec }) => {
      const autosar = AutocoderCRust.generateAutosarSWC(spec);
      return { success: true, validationLevel: 'experimental', ...autosar };
    },
    {
      domain: 'controls',
      description: 'Generate experimental code from an explicit state-space model; AUTOSAR conformance is not assessed'
    }
  );

  // 14. Experimental aerospace route, unavailable pending independent validation
  defineHandler(
    'omni:solve-nasa-rocket',
    {
      type: 'object',
      optional: true
    },
    async () => ({
      success: false,
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message:
          'Aerospace calculations are unavailable until the legacy models have independent reference data and review.'
      }
    }),
    {
      domain: 'aerospace',
      description: 'Unavailable experimental legacy aerospace route; no independent validation is established'
    }
  );

  // 15. Sourced spacecraft specification, unavailable pending independent validation
  defineHandler(
    'omni:get-nasa-spacecraft-spec',
    {
      type: 'object',
      optional: true
    },
    async () => ({
      success: false,
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message: 'No sourced, independently reviewed spacecraft specification is available.'
      }
    }),
    {
      domain: 'aerospace',
      description: 'Unavailable: no sourced, independently reviewed spacecraft specification exists'
    }
  );
}

module.exports = {
  registerControlsIpc,
  BLOCK_DIAGRAM_REQUEST_SCHEMA,
  validateBlockDiagramGraph,
  runBlockDiagramSimulation
};
