/**
 * OmniEng Neural Network Test Suite
 *
 * Proves the genuine MLP module (no mocks, no keyword-macro facade):
 *   - deterministic seeded RNG (reproducible)
 *   - numeric gradient check: analytic dL/dW vs finite differences < 1e-6
 *     for both MSE and cross-entropy losses
 *   - real learning: y = sin(x1) * cos(x2) from 400 seeded samples with a
 *     12-unit hidden layer; final training loss < 20% of initial
 *   - held-out 200-sample R² > 0.85
 *   - inference deterministic given the same weights (JSON round-trip,
 *     file save/load)
 *   - identical seeds => identical training
 *   - integration through the engine IPC adapter routes
 *     (omni:ai-train-surrogate / omni:ai-predict-surrogate / omni:ai-gradient-check)
 */

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');

const repositoryRoot = path.resolve(__dirname, '..');

const {
  NeuralNetwork,
  createNetwork,
  trainSurrogate,
  predictSurrogate,
  gradientCheck,
  saveModel,
  loadModel,
  SeededRNG,
  omniAI
} = require('../src/core/ai/neural_net');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function generateSinCos(seed, count) {
  const rng = new SeededRNG(seed);
  const inputs = [];
  const outputs = [];
  for (let i = 0; i < count; i++) {
    const x1 = rng.uniform(-Math.PI, Math.PI);
    const x2 = rng.uniform(-Math.PI, Math.PI);
    inputs.push([x1, x2]);
    outputs.push([Math.sin(x1) * Math.cos(x2)]);
  }
  return { inputs, outputs };
}

function r2Score(predictions, actuals) {
  const n = predictions.length;
  const meanY = actuals.reduce((s, v) => s + v, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (actuals[i] - predictions[i]) ** 2;
    ssTot += (actuals[i] - meanY) ** 2;
  }
  return 1 - ssRes / ssTot;
}

function isStrictlyDecreasing(lossHistory) {
  for (let i = 1; i < lossHistory.length; i++) {
    if (lossHistory[i] >= lossHistory[i - 1]) return false;
  }
  return true;
}

function isFiniteDeep(value, seen = new Set()) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return Array.from(value).every(Number.isFinite);
  return Object.values(value).every((entry) => isFiniteDeep(entry, seen));
}

let passed = 0;
let failed = 0;
function record(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ✓ PASS ${name}${detail ? ` [${detail}]` : ''}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL ${name}${detail ? ` [${detail}]` : ''}`);
  }
}

(async () => {
  console.log('================================================================');
  console.log('       TESTING GENUINE NEURAL NETWORK MODULE (MLP)             ');
  console.log('================================================================\n');

  // 1. Seeded RNG determinism
  console.log('[1] Seeded RNG determinism...');
  {
    const a = new SeededRNG(1234);
    const b = new SeededRNG(1234);
    const seqA = [];
    const seqB = [];
    for (let i = 0; i < 200; i++) {
      seqA.push(a.next());
      seqB.push(b.next());
    }
    assert.deepEqual(seqA, seqB);
    assert(seqA.every((v) => typeof v === 'number' && v >= 0 && v < 1));
    const shuffledA = new SeededRNG(99).shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const shuffledB = new SeededRNG(99).shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(shuffledA, shuffledB);
    record('seeded RNG reproducible', true, '200 draws + shuffle');
  }

  // 2. Numeric gradient check — MSE with tanh hidden layer
  console.log('[2] Gradient check (MSE, tanh, 2-3-2)...');
  let gc;
  {
    const net = createNetwork({
      inputSize: 2,
      hiddenUnits: [3],
      outputSize: 2,
      activation: 'tanh',
      loss: 'mse',
      seed: 1
    });
    const X = [
      [0.3, -0.7],
      [1.2, 0.5]
    ];
    const Y = [
      [0.8, -0.3],
      [-0.4, 0.9]
    ];
    gc = gradientCheck(net, X, Y, { eps: 1e-6, threshold: 1e-6 });
    record(
      'MSE gradient check maxAbsDiff < 1e-6',
      gc.passed && gc.maxAbsDiff < 1e-6,
      `maxAbsDiff=${gc.maxAbsDiff.toExponential(3)} over ${gc.checks} params`
    );
  }

  // 3. Numeric gradient check — cross-entropy with softmax output
  console.log('[3] Gradient check (cross-entropy, softmax, 2-3-3)...');
  {
    const net = createNetwork({
      inputSize: 2,
      hiddenUnits: [3],
      outputSize: 3,
      activation: 'tanh',
      loss: 'crossEntropy',
      seed: 2
    });
    const X = [
      [0.5, -0.2],
      [0.1, 0.9]
    ];
    const Y = [
      [1, 0, 0],
      [0, 0, 1]
    ];
    const gce = gradientCheck(net, X, Y, { eps: 1e-6, threshold: 1e-6 });
    record(
      'cross-entropy gradient check maxAbsDiff < 1e-6',
      gce.passed && gce.maxAbsDiff < 1e-6,
      `maxAbsDiff=${gce.maxAbsDiff.toExponential(3)} over ${gce.checks} params`
    );
  }

  // 4. Real learning: y = sin(x1) * cos(x2)
  console.log('[4] Training MLP (12 hidden tanh units) on y = sin(x1)*cos(x2)...');
  const trainData = generateSinCos(42, 400);
  const heldOut = generateSinCos(43, 200);
  const trainConfig = {
    hiddenUnits: [12],
    activation: 'tanh',
    loss: 'mse',
    epochs: 600,
    batchSize: 32,
    learningRate: 0.05,
    momentum: 0.9,
    seed: 7
  };
  let trained;
  {
    trained = trainSurrogate(trainData, trainConfig);
    const { model, lossHistory, converged, initialLoss, finalLoss } = trained;
    assert(model instanceof NeuralNetwork);
    assert.strictEqual(lossHistory.length, 600);
    assert(isFiniteDeep(lossHistory), 'loss history must remain finite');
    record(
      'final loss < 20% of initial',
      finalLoss < initialLoss * 0.2,
      `initial=${initialLoss.toFixed(4)} final=${finalLoss.toExponential(3)}`
    );
    if (isStrictlyDecreasing(lossHistory)) {
      record('loss decreased monotonically', true, '600/600 steps decreasing');
    } else {
      console.log('  (info) loss not strictly monotonic at every epoch; final loss criterion above governs.');
    }
    record('converged flag set', converged === true);
    console.log(
      `  loss curve: first=${lossHistory[0].toFixed(6)}  @100=${lossHistory[99].toFixed(6)}  @300=${lossHistory[299].toFixed(6)}  last=${lossHistory[599].toFixed(6)}`
    );
  }

  // 5. Held-out R²
  console.log('[5] Held-out evaluation (200 unseen samples)...');
  let heldOutR2;
  {
    const predictions = predictSurrogate(trained.model, heldOut.inputs).map((p) => p[0]);
    const actuals = heldOut.outputs.map((o) => o[0]);
    heldOutR2 = r2Score(predictions, actuals);
    record('held-out R² > 0.85', heldOutR2 > 0.85, `R²=${heldOutR2.toFixed(4)}`);
  }

  // 6. Inference determinism + JSON round-trip + file save/load
  console.log('[6] Deterministic inference given same weights (save/load)...');
  {
    const once = predictSurrogate(trained.model, heldOut.inputs.slice(0, 20));
    const again = predictSurrogate(trained.model, heldOut.inputs.slice(0, 20));
    assert.deepEqual(once, again);
    record('repeat inference identical', true);

    const restored = NeuralNetwork.fromJSON(trained.model.toJSON());
    assert.deepEqual(predictSurrogate(restored, heldOut.inputs.slice(0, 20)), once);
    record('JSON round-trip preserves inference', true);

    const tmpFile = path.join(os.tmpdir(), `omnieng-nn-${process.pid}-${Date.now()}.json`);
    saveModel(trained.model, tmpFile);
    const loaded = loadModel(tmpFile);
    assert.deepEqual(predictSurrogate(loaded, heldOut.inputs.slice(0, 20)), once);
    assert.deepEqual(loaded.toJSON(), trained.model.toJSON());
    fs.rmSync(tmpFile, { force: true });
    record('file save/load preserves weights & inference', true);

    const errFile = path.join(os.tmpdir(), `omnieng-nn-bad-${process.pid}.json`);
    fs.writeFileSync(errFile, '{"format":"not-a-neural-net"}', 'utf8');
    assert.throws(() => loadModel(errFile), TypeError);
    fs.rmSync(errFile, { force: true });
    record('loadModel rejects invalid payload', true);
  }

  // 7. Deterministic training given same seed
  console.log('[7] Training determinism (same seed -> identical history)...');
  {
    const first = trainSurrogate(trainData, trainConfig);
    const second = trainSurrogate(trainData, trainConfig);
    assert.deepEqual(first.lossHistory, second.lossHistory);
    assert.deepEqual(first.model.toJSON(), second.model.toJSON());
    record('same seed reproduces identical training', true);
  }

  // 8. omniAI API exposure
  console.log('[8] omniAI API exposure...');
  {
    assert.strictEqual(typeof omniAI.trainSurrogate, 'function');
    assert.strictEqual(typeof omniAI.predictSurrogate, 'function');
    assert.strictEqual(typeof omniAI.gradientCheck, 'function');
    assert.strictEqual(typeof omniAI.saveModel, 'function');
    assert.strictEqual(typeof omniAI.loadModel, 'function');
    assert.strictEqual(typeof omniAI.NeuralNetwork, 'function');
    assert.strictEqual(typeof omniAI.createNetwork, 'function');
    record('omniAI namespace exposes train/predict/save/load', true);
  }

  // 9. Engine adapter IPC routes
  console.log('[9] IPC adapter routes (omni:ai-train-surrogate / predict / gradient-check)...');
  {
    const handlers = new Map();
    const electronMock = {
      app: { getAppPath: () => repositoryRoot },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: {}
    };
    const originalLoad = Module._load;
    Module._load = function loadWithElectronIpcMock(request, parent, isMain) {
      if (request === 'electron') return electronMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    let defineHandlerModule;
    try {
      const ipcIndex = require('../src/main/ipc/index');
      defineHandlerModule = require('../src/main/ipc/define_handler');
      defineHandlerModule.channelRegistry.clear();
      handlers.clear();
      ipcIndex.registerAllIpcHandlers({ ipcMain: electronMock.ipcMain });
    } finally {
      Module._load = originalLoad;
    }

    const entryUrl = pathToFileURL(path.join(repositoryRoot, 'src', 'index.html')).href;
    const trustedEvent = {
      sender: { isDestroyed: () => false, mainFrame: { frameTreeNodeId: 42 } },
      senderFrame: { frameTreeNodeId: 42, url: entryUrl }
    };

    record('train route registered', handlers.has('omni:ai-train-surrogate'));
    record('predict route registered', handlers.has('omni:ai-predict-surrogate'));
    record('gradient-check route registered', handlers.has('omni:ai-gradient-check'));

    const trainRes = await handlers.get('omni:ai-train-surrogate')(trustedEvent, {
      dataset: trainData,
      config: trainConfig
    });
    record('train route returns success', trainRes.success === true);
    record(
      'train route returns finite loss history',
      Array.isArray(trainRes.lossHistory) && isFiniteDeep(trainRes.lossHistory)
    );
    record(
      'train route converges (<20% initial)',
      trainRes.converged === true && trainRes.finalLoss < trainRes.initialLoss * 0.2,
      `final=${trainRes.finalLoss.toExponential(3)}`
    );
    assert(trainRes.model && trainRes.model.format === 'omnieng-neural-net-v1');
    record('train route returns serialized model', true);

    const predictRes = await handlers.get('omni:ai-predict-surrogate')(trustedEvent, {
      model: trainRes.model,
      x: heldOut.inputs.slice(0, 50)
    });
    record('predict route returns success', predictRes.success === true);
    record(
      'predict route outputs finite & shaped',
      Array.isArray(predictRes.predictions) &&
        predictRes.predictions.length === 50 &&
        isFiniteDeep(predictRes.predictions)
    );
    const predArray = predictRes.predictions.map((p) => p[0]);
    const actualArray = heldOut.outputs.slice(0, 50).map((o) => o[0]);
    const ipcR2 = r2Score(predArray, actualArray);
    record('predict route R² > 0.85 on 50 samples', ipcR2 > 0.85, `R²=${ipcR2.toFixed(4)}`);

    const gcRes = await handlers.get('omni:ai-gradient-check')(trustedEvent, {
      model: trainRes.model,
      x: trainData.inputs.slice(0, 4),
      y: trainData.outputs.slice(0, 4),
      options: { eps: 1e-6, threshold: 1e-6 }
    });
    record(
      'gradient-check route passes',
      gcRes.success === true && gcRes.passed === true && gcRes.maxAbsDiff < 1e-6,
      `maxAbsDiff=${gcRes.maxAbsDiff.toExponential(3)}`
    );

    let rejected = false;
    try {
      await handlers.get('omni:ai-train-surrogate')(trustedEvent, {});
    } catch {
      rejected = true;
    }
    record('train route fails closed on missing dataset', rejected);
  }

  // 10. Legacy keyword-macro route untouched
  console.log('[10] Legacy keyword-macro route preserved...');
  {
    const handlers = new Map();
    const electronMock = {
      app: { getAppPath: () => repositoryRoot },
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      dialog: {}
    };
    const originalLoad = Module._load;
    Module._load = function loadWithElectronIpcMock(request, parent, isMain) {
      if (request === 'electron') return electronMock;
      return originalLoad.call(this, request, parent, isMain);
    };
    let defineHandlerModule;
    try {
      const ipcIndex = require('../src/main/ipc/index');
      defineHandlerModule = require('../src/main/ipc/define_handler');
      defineHandlerModule.channelRegistry.clear();
      handlers.clear();
      ipcIndex.registerAllIpcHandlers({ ipcMain: electronMock.ipcMain });
    } finally {
      Module._load = originalLoad;
    }
    record('legacy ai-process-prompt still registered', handlers.has('omni:ai-process-prompt'));
  }

  console.log('\n================================================================');
  console.log(`  NEURAL NETWORK TESTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================');
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
