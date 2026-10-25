'use strict';

const { SpiceEngine } = require('./spice_engine');

const MAX_COMPONENTS = 24;
const MAX_MATRIX_DIMENSION = 12;
const MAX_TIME_STEPS = 2000;
const NODE_PATTERN = /^(?:0|[A-Za-z][A-Za-z0-9_.-]{0,31})$/;
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,31}$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function invalidInput(message) {
  return {
    success: false,
    status: 'invalid-input',
    validationLevel: 'experimental',
    error: { code: 'INVALID_INPUT', message }
  };
}

function validNode(value) {
  return typeof value === 'string' && NODE_PATTERN.test(value);
}

function validateWaveform(waveform) {
  if (!isRecord(waveform) || typeof waveform.type !== 'string') {
    return 'A voltage-source waveform must declare its type and all required values.';
  }

  const specs = {
    STEP: { required: ['type', 'lowV', 'highV', 'delayS'] },
    SINE: { required: ['type', 'frequencyHz', 'offsetV', 'amplitudeV'] },
    PULSE: { required: ['type', 'lowV', 'highV', 'periodS', 'widthS'] }
  };
  const spec = specs[waveform.type];
  if (!spec || !hasExactKeys(waveform, spec.required)) {
    return 'Waveforms must be STEP, SINE, or PULSE records with exactly their required values.';
  }

  const values = spec.required.slice(1).map((key) => waveform[key]);
  if (!values.every(finiteNumber)) return 'Every waveform value must be a finite number in SI units.';
  if (waveform.type === 'STEP' && waveform.delayS < 0) return 'STEP delayS must be zero or greater.';
  if (waveform.type === 'SINE' && waveform.frequencyHz <= 0) return 'SINE frequencyHz must be greater than zero.';
  if (waveform.type === 'PULSE') {
    if (waveform.periodS <= 0 || waveform.widthS <= 0 || waveform.widthS > waveform.periodS) {
      return 'PULSE requires periodS > 0 and 0 < widthS <= periodS.';
    }
  }
  return null;
}

function validateComponent(component, ids, nodes) {
  if (!isRecord(component) || typeof component.type !== 'string')
    return 'Each component must be an object with a type.';
  const layouts = {
    resistor: { required: ['type', 'id', 'n1', 'n2', 'resistanceOhm'] },
    capacitor: { required: ['type', 'id', 'n1', 'n2', 'capacitanceF', 'initialVoltageV'] },
    inductor: { required: ['type', 'id', 'n1', 'n2', 'inductanceH', 'initialCurrentA'] },
    voltage_source: {
      required: ['type', 'id', 'nPlus', 'nMinus', 'dcVoltageV'],
      optional: ['waveform']
    },
    current_source: { required: ['type', 'id', 'nFrom', 'nTo', 'currentA'] }
  };
  const layout = layouts[component.type];
  if (!layout) return `Unsupported SPICE component type: ${component.type}.`;
  if (!hasExactKeys(component, layout.required, layout.optional)) {
    return `The ${component.type} component has missing or unsupported fields.`;
  }
  if (typeof component.id !== 'string' || !ID_PATTERN.test(component.id) || ids.has(component.id)) {
    return 'Component IDs must be unique and use 1–32 letters, digits, dots, underscores, or hyphens; the first character must be a letter.';
  }
  ids.add(component.id);

  const componentNodes = ['n1', 'n2', 'nPlus', 'nMinus', 'nFrom', 'nTo']
    .filter((key) => Object.hasOwn(component, key))
    .map((key) => component[key]);
  if (!componentNodes.every(validNode)) return 'Node names must be 1–32 characters; use 0 for ground.';
  for (const node of componentNodes) nodes.add(node);

  const values = {
    resistor: ['resistanceOhm'],
    capacitor: ['capacitanceF', 'initialVoltageV'],
    inductor: ['inductanceH', 'initialCurrentA'],
    voltage_source: ['dcVoltageV'],
    current_source: ['currentA']
  }[component.type];
  if (!values.every((key) => finiteNumber(component[key])))
    return `The ${component.type} requires finite numeric values in SI units.`;
  if (component.type === 'resistor' && component.resistanceOhm < 1e-12)
    return 'resistanceOhm must be at least 1e-12 Ω.';
  if (component.type === 'capacitor' && component.capacitanceF < 1e-18) return 'capacitanceF must be at least 1e-18 F.';
  if (component.type === 'inductor' && component.inductanceH < 1e-18) return 'inductanceH must be at least 1e-18 H.';
  if (component.waveform !== undefined && component.type !== 'voltage_source') {
    return 'Only voltage_source components may declare waveform data.';
  }
  if (component.waveform !== undefined) return validateWaveform(component.waveform);
  return null;
}

function connectNodes(component, adjacency) {
  const pair =
    component.type === 'voltage_source'
      ? [component.nPlus, component.nMinus]
      : component.type === 'current_source'
        ? [component.nFrom, component.nTo]
        : [component.n1, component.n2];
  adjacency.get(pair[0]).add(pair[1]);
  adjacency.get(pair[1]).add(pair[0]);
}

function normalizeRequest(request) {
  if (!hasExactKeys(request, ['analysis', 'components']))
    return { error: 'A SPICE request must contain only analysis and components.' };
  if (!hasExactKeys(request.analysis, ['type', 'stopTimeS', 'stepS'])) {
    return { error: 'analysis must provide type, stopTimeS, and stepS.' };
  }
  const { type, stopTimeS, stepS } = request.analysis;
  if (type !== 'transient' || !finiteNumber(stopTimeS) || !finiteNumber(stepS) || stopTimeS <= 0 || stepS <= 0) {
    return { error: 'A transient analysis requires finite, positive stopTimeS and stepS values.' };
  }
  const timeSteps = Math.ceil(stopTimeS / stepS);
  if (!Number.isSafeInteger(timeSteps) || timeSteps > MAX_TIME_STEPS) {
    return { error: `This experimental path is limited to ${MAX_TIME_STEPS} time steps per request.` };
  }
  if (
    !Array.isArray(request.components) ||
    request.components.length === 0 ||
    request.components.length > MAX_COMPONENTS
  ) {
    return { error: `Provide between 1 and ${MAX_COMPONENTS} explicit components.` };
  }

  const ids = new Set();
  const nodes = new Set();
  for (const component of request.components) {
    const error = validateComponent(component, ids, nodes);
    if (error) return { error };
  }
  if (!nodes.has('0')) return { error: 'The circuit must include the explicit ground node "0".' };

  const nodeIndex = new Map([...nodes].filter((node) => node !== '0').map((node, index) => [node, index]));
  const voltageSourceCount = request.components.filter((component) => component.type === 'voltage_source').length;
  const inductorCount = request.components.filter((component) => component.type === 'inductor').length;
  if (nodeIndex.size + voltageSourceCount + inductorCount > MAX_MATRIX_DIMENSION) {
    return { error: `This experimental path is limited to ${MAX_MATRIX_DIMENSION} MNA unknowns.` };
  }

  const adjacency = new Map([...nodes].map((node) => [node, new Set()]));
  for (const component of request.components) connectNodes(component, adjacency);
  const reachable = new Set(['0']);
  const queue = ['0'];
  while (queue.length) {
    for (const neighbor of adjacency.get(queue.shift())) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  if ([...nodes].some((node) => !reachable.has(node)))
    return { error: 'Every circuit node must be connected to ground.' };

  return { analysis: { type, stopTimeS, stepS }, components: request.components };
}

function solveSpiceTransient(request) {
  const normalized = normalizeRequest(request);
  if (normalized.error) return invalidInput(normalized.error);

  try {
    const spice = new SpiceEngine();
    for (const component of normalized.components) {
      switch (component.type) {
        case 'resistor':
          spice.addResistor(component.id, component.n1, component.n2, component.resistanceOhm);
          break;
        case 'capacitor':
          spice.addCapacitor(
            component.id,
            component.n1,
            component.n2,
            component.capacitanceF,
            component.initialVoltageV
          );
          break;
        case 'inductor':
          spice.addInductor(component.id, component.n1, component.n2, component.inductanceH, component.initialCurrentA);
          break;
        case 'voltage_source': {
          const waveform = component.waveform
            ? {
                type: component.waveform.type,
                v1: component.waveform.lowV,
                v2: component.waveform.highV,
                delay: component.waveform.delayS,
                freq: component.waveform.frequencyHz,
                offset: component.waveform.offsetV,
                amplitude: component.waveform.amplitudeV,
                period: component.waveform.periodS,
                width: component.waveform.widthS
              }
            : null;
          spice.addVoltageSource(component.id, component.nPlus, component.nMinus, component.dcVoltageV, waveform);
          break;
        }
        case 'current_source':
          spice.addCurrentSource(component.id, component.nFrom, component.nTo, component.currentA);
          break;
      }
    }

    const transient = spice.runTransient(normalized.analysis.stopTimeS, normalized.analysis.stepS);
    const allValues = [...transient.time, ...Object.values(transient.nodes).flat()];
    if (allValues.length === 0 || allValues.some((value) => !finiteNumber(value))) {
      return {
        success: false,
        status: 'numerical-failure',
        validationLevel: 'experimental',
        error: { code: 'NUMERICAL_FAILURE', message: 'The transient engine returned empty or non-finite samples.' }
      };
    }
    return {
      success: true,
      status: 'experimental',
      validationLevel: 'experimental',
      dataStatus: 'caller-supplied inputs',
      analysis: { ...normalized.analysis, integrationMethod: 'backward Euler' },
      transient,
      warnings: [
        'This experimental modified nodal analysis path has not been independently validated for accuracy or convergence.',
        'The viewer plots node voltages only; device currents and other instrument measurements are not reported.'
      ]
    };
  } catch {
    return {
      success: false,
      status: 'numerical-failure',
      validationLevel: 'experimental',
      error: {
        code: 'NUMERICAL_FAILURE',
        message: 'The transient solve failed, likely because the circuit matrix is singular or numerically unsupported.'
      }
    };
  }
}

module.exports = { solveSpiceTransient };
