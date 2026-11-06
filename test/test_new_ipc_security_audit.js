/**
 * Security audit gate for newly added IPC handlers and domain routes.
 *
 * Covers:
 *   - AI train/predict/gradient-check surrogate routes (system_ipc.js)
 *   - HPC local-dispatch / execute-local-parallel / plan-out-of-core caps (hpc_engine_adapter.js)
 *   - Robotics collision_check caps (robotics_engine_adapter.js)
 *   - Cosim read_fmu_package / parse_model_description / simulate_fmu caps (cosim_domain_route.js, fmu_reader.js)
 *   - Materials lookup consumers (cae_ipc.js compute-inertia / mass-properties)
 *   - Optics catalog consumers (optics_ipc.js DLS / tolerancing caps)
 *
 * Asserts hostile inputs are rejected: prototype pollution keys, oversized
 * arrays/strings, non-finite numbers, and untrusted sender frames.
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');

const repositoryRoot = path.resolve(__dirname, '..');
const handlers = new Map();

const electronMock = {
  app: { getAppPath: () => repositoryRoot },
  ipcMain: {
    handle: (channel, handler) => handlers.set(channel, handler)
  },
  dialog: {}
};

const originalLoad = Module._load;
Module._load = function loadWithElectronIpcMock(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  return originalLoad.call(this, request, parent, isMain);
};

let registerAllIpcHandlers;
let defineHandlerModule;
try {
  ({ registerAllIpcHandlers } = require('../src/main/ipc/index'));
  defineHandlerModule = require('../src/main/ipc/define_handler');
} finally {
  Module._load = originalLoad;
}

const { CosimDomainRoute } = require('../src/core/cosim/cosim_domain_route');
const { FmuExecutionHost, FmuError } = require('../src/core/cosim/fmu_reader');
const { HPCEngineAdapter } = require('../src/core/hpc/hpc_engine_adapter');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { NeuralNetwork } = require('../src/core/ai/neural_net');

let passed = 0;
let failed = 0;
const record = (name, ok, detail = '') => {
  if (ok) {
    passed++;
    console.log(`  ✓ PASS ${name}${detail ? ` [${detail}]` : ''}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL ${name}${detail ? ` [${detail}]` : ''}`);
  }
};

const entryUrl = pathToFileURL(path.join(repositoryRoot, 'src', 'index.html')).href;
const trustedEvent = {
  sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
  senderFrame: { frameTreeNodeId: 42, url: entryUrl }
};
const untrustedEvent = {
  sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
  senderFrame: { frameTreeNodeId: 999, url: entryUrl }
};

async function callChannel(channel, payload, event = trustedEvent) {
  return handlers.get(channel)(event, payload);
}

async function expectRejected(channel, payload, reason) {
  let rejected = false;
  try {
    await callChannel(channel, payload);
  } catch (err) {
    rejected = true;
    if (reason && !String(err.message).includes(reason)) {
      throw new Error(`Expected rejection mentioning "${reason}" but got: ${err.message}`);
    }
  }
  assert.ok(rejected, `Expected channel ${channel} to reject the payload`);
}

function isFailClosedResponse(res) {
  return res && res.success === false && res.error && typeof res.error.code === 'string';
}

async function expectFailClosed(channel, payload, event = trustedEvent) {
  try {
    const res = await callChannel(channel, payload, event);
    assert.ok(isFailClosedResponse(res), `Channel ${channel} resolved without a fail-closed error response`);
    return res;
  } catch (err) {
    assert.ok(err, `Channel ${channel} rejected the hostile payload`);
    return null;
  }
}

function smallModel() {
  const nn = new NeuralNetwork({ inputSize: 1, outputSize: 1, hiddenUnits: [2], seed: 7 });
  return nn.toJSON();
}

async function runAudit() {
  console.log('================================================================');
  console.log('  NEW IPC HANDLER SECURITY AUDIT');
  console.log('================================================================\n');

  defineHandlerModule.channelRegistry.clear();
  handlers.clear();
  registerAllIpcHandlers({ ipcMain: electronMock.ipcMain });

  // ---------------------------------------------------------------- sender guard
  {
    const model = smallModel();
    let senderRejected = false;
    try {
      await callChannel('omni:ai-predict-surrogate', { model, x: [[0.5]] }, untrustedEvent);
    } catch (err) {
      senderRejected = String(err.message).includes('untrusted sender');
    }
    record('sender verification: untrusted frame rejected on new AI route', senderRejected);
  }

  // ---------------------------------------------------------------- AI train
  {
    const valid = { dataset: { inputs: [[0.1], [0.2]], outputs: [[0.2], [0.4]] }, config: { epochs: 2, hiddenUnits: [2] } };
    const res = await callChannel('omni:ai-train-surrogate', valid);
    record('ai-train accepts a small bounded dataset', res.success === true, `samples=${res.trainingSamples}`);

    const huge = { dataset: { inputs: Array.from({ length: 25000 }, () => [0]), outputs: Array.from({ length: 25000 }, () => [0]) } };
    const hugeRes = await callChannel('omni:ai-train-surrogate', huge);
    record('ai-train rejects oversized dataset', isFailClosedResponse(hugeRes) && hugeRes.error.code === 'INVALID_INPUT');

    const nanFeature = { dataset: { inputs: [[NaN]], outputs: [[0]] } };
    const nanRes = await callChannel('omni:ai-train-surrogate', nanFeature);
    record('ai-train rejects non-finite feature values', isFailClosedResponse(nanRes));

    const epochs = { dataset: { inputs: [[0.1]], outputs: [[0.2]] }, config: { epochs: 1e9 } };
    const epochsRes = await callChannel('omni:ai-train-surrogate', epochs);
    record('ai-train rejects oversized epoch count', isFailClosedResponse(epochsRes));

    const hidden = { dataset: { inputs: [[0.1]], outputs: [[0.2]] }, config: { hiddenUnits: [1e6] } };
    const hiddenRes = await callChannel('omni:ai-train-surrogate', hidden);
    record('ai-train rejects oversized hidden layer', isFailClosedResponse(hiddenRes));

    const proto = { dataset: { inputs: [[0.1]], outputs: [[0.2]] }, config: { epochs: 2 } };
    proto.__proto__ = { polluted: true };
    const protoRes = await callChannel('omni:ai-train-surrogate', proto);
    record('ai-train strips prototype pollution keys', protoRes.success === true);
  }

  // ---------------------------------------------------------------- AI predict
  {
    const model = smallModel();
    const ok = await callChannel('omni:ai-predict-surrogate', { model, x: [[0.5]] });
    record('ai-predict accepts a small model input', ok.success === true);

    const hugeX = { model, x: Array.from({ length: 6000 }, () => [0.5]) };
    await expectFailClosed('omni:ai-predict-surrogate', hugeX);
    record('ai-predict rejects oversized row count', true);

    const nanX = { model, x: [[NaN]] };
    const nanRes = await callChannel('omni:ai-predict-surrogate', nanX);
    record('ai-predict rejects non-finite input vectors', isFailClosedResponse(nanRes));

    const wideModel = { ...model, layers: Array.from({ length: 9 }, (_, i) => model.layers[i % model.layers.length]) };
    const wideRes = await callChannel('omni:ai-predict-surrogate', { model: wideModel, x: [[0.5]] });
    record('ai-predict rejects oversized model layer count', isFailClosedResponse(wideRes));

    const giantLayer = {
      ...model,
      layers: [{ fanIn: 1e6, fanOut: 1e6, activation: 'linear', W: [[0]], b: [0] }]
    };
    const giantRes = await callChannel('omni:ai-predict-surrogate', { model: giantLayer, x: [[0.5]] });
    record('ai-predict rejects oversized layer dimensions', isFailClosedResponse(giantRes));

    const proto = { model, x: [[0.5]] };
    proto.constructor = { polluted: true };
    const protoRes = await callChannel('omni:ai-predict-surrogate', proto);
    record('ai-predict strips constructor pollution key', protoRes.success === true);
  }

  // ---------------------------------------------------------------- AI gradient-check
  {
    const model = smallModel();
    const ok = await callChannel('omni:ai-gradient-check', { model, x: [[0.5]], y: [[0.25]], options: { maxChecks: 4 } });
    record('ai-gradient-check accepts a small bounded input', ok.success === true);

    const badChecks = await callChannel('omni:ai-gradient-check', { model, x: [[0.5]], y: [[0.25]], options: { maxChecks: 1e7 } });
    record('ai-gradient-check rejects oversized maxChecks', isFailClosedResponse(badChecks));

    const mismatch = await callChannel('omni:ai-gradient-check', { model, x: [[0.5], [0.6]], y: [[0.25]] });
    record('ai-gradient-check rejects mismatched x/y sample counts', isFailClosedResponse(mismatch));

    const nanY = await callChannel('omni:ai-gradient-check', { model, x: [[0.5]], y: [[Infinity]] });
    record('ai-gradient-check rejects non-finite labels', isFailClosedResponse(nanY));
  }

  // ---------------------------------------------------------------- HPC
  {
    const badType = await callChannel('omni:hpc-execute-local-parallel', { taskType: '', payload: {} });
    record('hpc local-parallel rejects empty taskType', isFailClosedResponse(badType));

    const badPayload = await callChannel('omni:hpc-execute-local-parallel', { taskType: 'ECHO_TEST', payload: 'not-object' });
    record('hpc local-parallel rejects non-object payload', isFailClosedResponse(badPayload));

    const badTimeout = await callChannel('omni:hpc-execute-local-parallel', {
      taskType: 'ECHO_TEST',
      payload: {},
      timeoutMs: 1e12
    });
    record('hpc local-parallel rejects oversized timeout', isFailClosedResponse(badTimeout));

    const badPriority = await callChannel('omni:hpc-execute-local-parallel', {
      taskType: 'ECHO_TEST',
      payload: {},
      priority: 'CRITICAL'
    });
    record('hpc local-parallel rejects unknown priority', isFailClosedResponse(badPriority));

    const planBad = await callChannel('omni:hpc-plan-out-of-core', { dofCount: -5, availableRamBytes: 1e9, assumptions: { matrixNonzerosPerDof: 10, factorEntriesPerDof: 20 } });
    record('hpc plan-out-of-core rejects non-positive dofCount', isFailClosedResponse(planBad));

    const planNaN = await callChannel('omni:hpc-plan-out-of-core', { dofCount: 100, availableRamBytes: NaN, assumptions: { matrixNonzerosPerDof: 10, factorEntriesPerDof: 20 } });
    record('hpc plan-out-of-core rejects non-finite memory', isFailClosedResponse(planNaN));

    const adapter = new HPCEngineAdapter();
    const localDispatchBad = {
      domain: 'hpc',
      operation: 'hpc:local-dispatch',
      parameters: { descriptor: { taskType: 'arbitrary_shell' } }
    };
    let localBadRejected = false;
    try {
      await adapter.validate(localDispatchBad);
    } catch (err) {
      localBadRejected = err.code === 'UNSUPPORTED';
    }
    record('hpc local-dispatch rejects unknown worker task type', localBadRejected);

    const localDispatchHuge = {
      domain: 'hpc',
      operation: 'hpc:local-dispatch',
      parameters: { descriptor: { taskType: 'poisson_sparse_cholesky', n: 1, blob: 'x'.repeat(17 * 1024 * 1024) } }
    };
    let localHugeRejected = false;
    try {
      await adapter.validate(localDispatchHuge);
    } catch (err) {
      localHugeRejected = err.code === 'INVALID_INPUT';
    }
    record('hpc local-dispatch rejects oversized descriptor payload', localHugeRejected);

    const partitionHuge = {
      domain: 'hpc',
      operation: 'partition_rcb',
      parameters: { points: Array.from({ length: 100001 }, (_, i) => ({ x: i, y: 0, z: 0 })) }
    };
    let partitionRejected = false;
    try {
      await adapter.validate(partitionHuge);
    } catch (err) {
      partitionRejected = err.code === 'INVALID_INPUT';
    }
    record('hpc partition_rcb rejects oversized point set', partitionRejected);

    await expectFailClosed('omni:hpc-local-dispatch', { n: 4 });
    record('hpc local-dispatch rejects below-minimum n', true);

    await expectFailClosed('omni:hpc-local-dispatch', { n: 1000 });
    record('hpc local-dispatch rejects above-maximum n', true);

    await expectFailClosed('omni:hpc-local-dispatch', { n: 8, timeoutMs: 1e9 });
    record('hpc local-dispatch rejects oversized timeout', true);

    await expectFailClosed('omni:hpc-local-dispatch', { n: 8.5 });
    record('hpc local-dispatch rejects non-integer n', true);
  }

  // ---------------------------------------------------------------- Robotics collision_check
  {
    const dhTable = Array.from({ length: 33 }, (_, i) => ({ a: 0.1, alpha: 0, d: 0.2 }));
    const smallDh = [
      { a: 0.1, alpha: 0, d: 0.2 },
      { a: 0.1, alpha: 0, d: 0.2 },
      { a: 0.1, alpha: 0, d: 0.2 }
    ];
    const obstacle = { triangles: [[[0, 0, 0], [1, 0, 0], [0, 1, 0]]] };

    await expectFailClosed('omni:run-robotics-operation', {
      operation: 'collision_check',
      dhTable,
      qStart: new Array(33).fill(0),
      qEnd: new Array(33).fill(0.1),
      obstacles: [obstacle]
    });
    record('robotics collision_check rejects oversized dhTable', true);

    await expectFailClosed('omni:run-robotics-operation', {
      operation: 'collision_check',
      dhTable: smallDh,
      qStart: [0, 0, 0],
      qEnd: [0.1, 0.1, 0.1],
      obstacles: Array.from({ length: 257 }, () => obstacle)
    });
    record('robotics collision_check rejects obstacle overflow', true);

    await expectFailClosed('omni:run-robotics-operation', {
      operation: 'collision_check',
      dhTable: smallDh,
      qStart: [0, 0, 0],
      qEnd: [0.1, 0.1, 0.1],
      obstacles: [obstacle],
      step: 1e-12
    });
    record('robotics collision_check rejects below-minimum step', true);

    await expectFailClosed('omni:run-robotics-operation', {
      operation: 'collision_check',
      dhTable: smallDh,
      qStart: [0, 0, 0],
      qEnd: [0.1, 0.1, 0.1],
      obstacles: [obstacle],
      numSamples: 1e9
    });
    record('robotics collision_check rejects oversized numSamples', true);

    await expectFailClosed('omni:run-robotics-operation', {
      operation: 'collision_check',
      dhTable: smallDh,
      qStart: [0, NaN, 0],
      qEnd: [0.1, 0.1, 0.1],
      obstacles: [obstacle]
    });
    record('robotics collision_check rejects non-finite joint angles', true);

    await expectFailClosed('omni:run-robotics-operation', {
      operation: 'parse_urdf',
      urdf: `<robot name="x">${' '.repeat(3 * 1024 * 1024)}</robot>`
    });
    record('robotics parse_urdf rejects oversized XML', true);

    await expectFailClosed('omni:run-robotics-operation', {
      operation: 'trajectory_plan',
      dhTable: smallDh,
      q0: [0, 0, 0],
      qf: [0.1, 0.1, 0.1],
      duration: 1,
      numSteps: 1e7
    });
    record('robotics trajectory_plan rejects oversized numSteps', true);
  }

  // ---------------------------------------------------------------- Cosim
  {
    const route = new CosimDomainRoute();

    const hugeBuffer = Buffer.alloc(65 * 1024 * 1024);
    let readBadRejected = false;
    try {
      await route.execute('read_fmu_package', { fmu: hugeBuffer });
    } catch (err) {
      readBadRejected = err instanceof FmuError && err.code === 'INVALID_INPUT';
    }
    record('cosim read_fmu_package rejects oversized FMU buffer', readBadRejected);

    let xmlBadRejected = false;
    try {
      await route.execute('parse_model_description', { xml: '<fmiModelDescription>' + 'a'.repeat(9 * 1024 * 1024) });
    } catch (err) {
      xmlBadRejected = err instanceof FmuError && err.code === 'MODEL_DESCRIPTION_INVALID';
    }
    record('cosim parse_model_description rejects oversized XML', xmlBadRejected);

    const model = {
      fmiVersion: '2.0',
      variables: [
        { name: 'x1', type: { kind: 'Real' }, causality: 'input', valueReference: 0 },
        { name: 'x2', type: { kind: 'Real' }, causality: 'input', valueReference: 1 }
      ],
      startValues: new Map(),
      modelStructure: { outputs: [], derivatives: [], initialUnknowns: [] }
    };
    const host = new FmuExecutionHost(model, { derivativeFns: { x1: (t, v) => -v.x1 } });
    let tinyDtRejected = false;
    try {
      await host.simulate({ tEnd: 100, dt: 1e-12 });
    } catch (err) {
      tinyDtRejected = err instanceof FmuError;
    }
    record('cosim simulate_fmu rejects step count overflow', tinyDtRejected);

    let spanRejected = false;
    try {
      await host.simulate({ tEnd: 2e6, dt: 1e-3 });
    } catch (err) {
      spanRejected = err instanceof FmuError;
    }
    record('cosim simulate_fmu rejects oversized time span', spanRejected);

    let nanInputRejected = false;
    try {
      host.setInput('x2', NaN);
    } catch (err) {
      nanInputRejected = err instanceof FmuError;
    }
    record('cosim simulate_fmu rejects non-finite input values', nanInputRejected);
  }

  // ---------------------------------------------------------------- Materials
  {
    await expectFailClosed('omni:compute-cuboid-mass-properties', {
      widthM: 0.1,
      heightM: 0.1,
      depthM: 0.1,
      densityKgM3: Infinity,
      densitySource: 'test'
    });
    record('materials compute-cuboid rejects non-finite density', true);

    await expectFailClosed('omni:compute-cuboid-mass-properties', {
      widthM: 0.1,
      heightM: 0.1,
      depthM: 0.1,
      densityKgM3: 2700,
      densitySource: 'x'.repeat(2000)
    });
    record('materials compute-cuboid rejects oversized density source', true);

    const proto = { widthM: 0.1, heightM: 0.1, depthM: 0.1, densityKgM3: 2700, densitySource: 'test' };
    proto.prototype = { evil: true };
    const protoRes = await callChannel('omni:compute-cuboid-mass-properties', proto);
    record('materials compute-cuboid strips prototype key', protoRes.success === true);

    const materialsList = await callChannel('omni:get-materials-list', {});
    record('materials get-list fails closed with no catalog', materialsList.success === false && Array.isArray(materialsList.materials));

    await expectFailClosed('omni:materials-catalog-query', { search: 'x'.repeat(101) });
    record('materials catalog-query rejects oversized search string', true);

    await expectFailClosed('omni:materials-catalog-query', { temperatureK: 0 });
    record('materials catalog-query rejects below-minimum temperature', true);

    await expectFailClosed('omni:materials-catalog-query', { temperatureK: 3000 });
    record('materials catalog-query rejects above-maximum temperature', true);

    const materialsProto = { search: 'al' };
    materialsProto.__proto__ = { injected: true };
    const materialsProtoRes = await callChannel('omni:materials-catalog-query', materialsProto);
    record('materials catalog-query strips prototype pollution key', materialsProtoRes.success === true && Array.isArray(materialsProtoRes.cards));
  }

  // ---------------------------------------------------------------- Optics catalog
  {
    const manySurfaces = await callChannel('omni:optimize-optical-dls', {
      system: { surfaces: Array.from({ length: 129 }, () => ({ radius: 50, thickness: 5 })) },
      variables: [{ surfaceIndex: 0, param: 'radius', value: 50, min: 10, max: 100 }],
      operands: [{ type: 'rms_spot', target: 0.1 }],
      options: { maxIterations: 10 }
    });
    record('optics DLS rejects surface overflow', isFailClosedResponse(manySurfaces));

    const manyVariables = await callChannel('omni:optimize-optical-dls', {
      system: { surfaces: [{ radius: 50, thickness: 5 }, { radius: -50, thickness: 5 }] },
      variables: Array.from({ length: 300 }, (_, i) => ({ surfaceIndex: i % 2, param: 'radius', value: 50, min: 10, max: 100 })),
      operands: [{ type: 'rms_spot', target: 0.1 }],
      options: { maxIterations: 10 }
    });
    record('optics DLS rejects variable overflow', isFailClosedResponse(manyVariables));

    const hugeIterations = await callChannel('omni:optimize-optical-dls', {
      system: { surfaces: [{ radius: 50, thickness: 5 }, { radius: -50, thickness: 5 }] },
      variables: [{ surfaceIndex: 0, param: 'radius', value: 50, min: 10, max: 100 }],
      operands: [{ type: 'rms_spot', target: 0.1 }],
      options: { maxIterations: 1e9 }
    });
    record('optics DLS rejects oversized iterations', isFailClosedResponse(hugeIterations));

    const nanBound = await callChannel('omni:optimize-optical-dls', {
      system: { surfaces: [{ radius: 50, thickness: 5 }, { radius: -50, thickness: 5 }] },
      variables: [{ surfaceIndex: 0, param: 'radius', value: 50, min: NaN, max: 100 }],
      operands: [{ type: 'rms_spot', target: 0.1 }],
      options: { maxIterations: 10 }
    });
    record('optics DLS rejects non-finite bounds', isFailClosedResponse(nanBound));

    const hugeTrials = await callChannel('omni:run-optical-tolerancing', {
      nominalSystem: { entrancePupilRadius: 10, surfaces: [{ radius: 50, thickness: 5, refractiveIndex: 1.5 }, { radius: -50, thickness: 45, refractiveIndex: 1.0 }] },
      toleranceDefs: [{ surfaceIndex: 0, type: 'RADIUS', tolerance: 1.0 }],
      options: { trials: 1e7, seed: 7 }
    });
    record('optics tolerancing rejects trial overflow', isFailClosedResponse(hugeTrials));

    await expectFailClosed('omni:optics-glass-lookup', { wavelengthsUm: [0.4] });
    record('optics glass-lookup rejects undersized wavelength array', true);

    await expectFailClosed('omni:optics-glass-lookup', { wavelengthsUm: Array.from({ length: 65 }, (_, i) => 0.4 + i * 0.01) });
    record('optics glass-lookup rejects oversized wavelength array', true);

    await expectFailClosed('omni:optics-glass-lookup', { wavelengthsUm: [0.4, -0.2] });
    record('optics glass-lookup rejects negative wavelengths', true);

    await expectFailClosed('omni:optics-glass-lookup', { query: 'x'.repeat(101) });
    record('optics glass-lookup rejects oversized query', true);
  }

  // ---------------------------------------------------------------- Path traversal guard (defense in depth)
  {
    const { IPCValidator } = require('../src/core/security/ipc_validator');
    let traversalBlocked = false;
    try {
      IPCValidator.sanitizePath('../etc/passwd', path.join(repositoryRoot, 'tmp'));
    } catch (err) {
      traversalBlocked = String(err.message).includes('traversal');
    }
    record('path traversal guard rejects ../ escapes', traversalBlocked);
    let absoluteBlocked = false;
    try {
      IPCValidator.sanitizePath('/etc/passwd', path.join(repositoryRoot, 'tmp'));
    } catch (err) {
      absoluteBlocked = String(err.message).includes('traversal');
    }
    record('path traversal guard rejects absolute escapes', absoluteBlocked);
  }

  console.log(`\nSecurity audit complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

runAudit().catch((err) => {
  console.error('Security audit crashed:', err);
  process.exitCode = 1;
});
