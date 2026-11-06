/**
 * OmniEng Neural Network Module
 *
 * A genuine multilayer perceptron implementation:
 *   - forward pass
 *   - backpropagation trainer (mini-batch SGD with momentum)
 *   - separable activation functions (sigmoid / tanh / ReLU / linear / softmax)
 *   - Xavier weight initialization
 *   - MSE and cross-entropy losses
 *   - numeric gradient check (analytic dL/dW vs central finite differences)
 *   - deterministic seeded RNG (no Math.random anywhere)
 *   - JSON save/load of weights (in-memory and file based)
 *
 * The high-level API mirrors the surrogate workflow:
 *   omniAI.trainSurrogate(dataset, config) -> { model, lossHistory, converged }
 *   omniAI.predictSurrogate(model, x)       -> predictions
 */

'use strict';

const fs = require('fs');

/* ------------------------------------------------------------------ */
/* Deterministic seeded RNG (mulberry32) — no Math.random              */
/* ------------------------------------------------------------------ */
class SeededRNG {
  constructor(seed = 42) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  next() {
    let a = this.state | 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    this.state = a;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(min = 0, max = 1) {
    return min + (max - min) * this.next();
  }

  int(min, max) {
    return Math.floor(this.uniform(min, max + 1));
  }

  shuffle(array) {
    const out = array.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Separable activations                                               */
/* ------------------------------------------------------------------ */
const ACTIVATIONS = {
  linear: {
    apply: (z) => z.slice(),
    derivative: (z, a) => new Array(a.length).fill(1)
  },
  sigmoid: {
    apply(z) {
      const out = new Array(z.length);
      for (let i = 0; i < z.length; i++) {
        const v = z[i];
        out[i] = v >= 0 ? 1 / (1 + Math.exp(-v)) : Math.exp(v) / (1 + Math.exp(v));
      }
      return out;
    },
    derivative: (z, a) => a.map((v) => v * (1 - v))
  },
  tanh: {
    apply: (z) => z.map((v) => Math.tanh(v)),
    derivative: (z, a) => a.map((v) => 1 - v * v)
  },
  relu: {
    apply: (z) => z.map((v) => (v > 0 ? v : 0)),
    derivative: (z, a) => z.map((v) => (v > 0 ? 1 : 0))
  },
  softmax: {
    apply(z) {
      let max = z[0];
      for (let i = 1; i < z.length; i++) if (z[i] > max) max = z[i];
      const exps = new Array(z.length);
      let sum = 0;
      for (let i = 0; i < z.length; i++) {
        exps[i] = Math.exp(z[i] - max);
        sum += exps[i];
      }
      for (let i = 0; i < exps.length; i++) exps[i] /= sum;
      return exps;
    },
    derivative: null // handled jointly with cross-entropy as the output layer
  }
};

const VALID_ACTIVATIONS = Object.keys(ACTIVATIONS);

/* ------------------------------------------------------------------ */
/* Losses                                                              */
/* ------------------------------------------------------------------ */
const LOSSES = {
  mse: {
    value(yhat, y) {
      let sum = 0;
      for (let i = 0; i < yhat.length; i++) {
        const d = yhat[i] - y[i];
        sum += d * d;
      }
      return sum / yhat.length;
    },
    gradient(yhat, y) {
      const g = new Array(yhat.length);
      for (let i = 0; i < yhat.length; i++) g[i] = (2 * (yhat[i] - y[i])) / yhat.length;
      return g;
    }
  },
  crossEntropy: {
    value(yhat, y) {
      let sum = 0;
      for (let i = 0; i < yhat.length; i++) {
        sum += y[i] * Math.log(Math.max(yhat[i], 1e-12));
      }
      return -sum / yhat.length;
    },
    // Combined CE + softmax gradient; valid only for a softmax output layer
    gradient(yhat, y) {
      const g = new Array(yhat.length);
      for (let i = 0; i < yhat.length; i++) g[i] = (yhat[i] - y[i]) / yhat.length;
      return g;
    }
  }
};

const VALID_LOSSES = Object.keys(LOSSES);

function assertFiniteArray(values, label) {
  if (!Array.isArray(values) || values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new TypeError(`${label} must be an array of finite numbers`);
  }
}

/* ------------------------------------------------------------------ */
/* Neural network                                                      */
/* ------------------------------------------------------------------ */
function zeroGrads(layers) {
  return layers.map((layer) => ({
    W: layer.W.map((row) => new Array(row.length).fill(0)),
    b: new Array(layer.b.length).fill(0)
  }));
}

function evalBatchLoss(network, X, Y, loss) {
  let total = 0;
  for (let s = 0; s < X.length; s++) total += LOSSES[loss].value(network.predict(X[s]), Y[s]);
  return total / X.length;
}

function buildLayers(config, rng) {
  const sizes = [config.inputSize, ...config.hiddenUnits, config.outputSize];
  const layers = [];
  for (let l = 1; l < sizes.length; l++) {
    const fanIn = sizes[l - 1];
    const fanOut = sizes[l];
    const limit = Math.sqrt(6 / (fanIn + fanOut));
    const W = [];
    for (let o = 0; o < fanOut; o++) {
      const row = new Array(fanIn);
      for (let i = 0; i < fanIn; i++) row[i] = rng.uniform(-limit, limit);
      W.push(row);
    }
    layers.push({
      fanIn,
      fanOut,
      W,
      b: new Array(fanOut).fill(0),
      activation: l === sizes.length - 1 ? config.outputActivation : config.activation
    });
  }
  return layers;
}

class NeuralNetwork {
  constructor(config = {}) {
    if (Array.isArray(config.layers) && config.layers.length > 0 && config.inputSize !== undefined) {
      this.inputSize = config.inputSize;
      this.loss = config.loss || 'mse';
      this.layers = config.layers.map((layer) => ({
        fanIn: layer.fanIn,
        fanOut: layer.fanOut,
        activation: layer.activation,
        W: layer.W.map((row) => row.slice()),
        b: layer.b.slice()
      }));
      this.meta = config.meta || {};
      return;
    }
    const inputSize = config.inputSize;
    const outputSize = config.outputSize;
    if (!Number.isInteger(inputSize) || inputSize < 1 || !Number.isInteger(outputSize) || outputSize < 1) {
      throw new TypeError('inputSize and outputSize must be positive integers');
    }
    const hiddenUnits = (config.hiddenUnits || []).map((u) => Number(u));
    if (hiddenUnits.some((u) => !Number.isInteger(u) || u < 1)) {
      throw new TypeError('hiddenUnits must be an array of positive integers');
    }
    const activation = config.activation || 'tanh';
    if (!VALID_ACTIVATIONS.includes(activation) || activation === 'softmax') {
      throw new TypeError(`Hidden activation must be one of sigmoid, tanh, relu, linear; got "${activation}"`);
    }
    const loss = config.loss || 'mse';
    if (!VALID_LOSSES.includes(loss)) {
      throw new TypeError(`Loss must be one of ${VALID_LOSSES.join(', ')}; got "${loss}"`);
    }
    let outputActivation = config.outputActivation || (loss === 'crossEntropy' ? 'softmax' : 'linear');
    if (!VALID_ACTIVATIONS.includes(outputActivation)) {
      throw new TypeError(`Unknown output activation "${outputActivation}"`);
    }
    if (outputActivation === 'softmax' && loss !== 'crossEntropy') {
      throw new TypeError('softmax output activation requires the crossEntropy loss');
    }
    if (loss === 'crossEntropy' && outputActivation !== 'softmax') {
      throw new TypeError('crossEntropy loss requires a softmax output activation');
    }
    const rng = new SeededRNG(config.seed ?? 0);
    this.inputSize = inputSize;
    this.loss = loss;
    this.layers = buildLayers({ inputSize, outputSize, hiddenUnits, activation, outputActivation }, rng);
    this.meta = {
      architecture: `mlp:${[inputSize, ...hiddenUnits, outputSize].join('-')}`,
      seed: config.seed ?? 0
    };
  }

  forward(x) {
    const acts = [x];
    const zs = [];
    for (let l = 0; l < this.layers.length; l++) {
      const layer = this.layers[l];
      const prev = acts[l];
      const z = new Array(layer.fanOut);
      for (let o = 0; o < layer.fanOut; o++) {
        const row = layer.W[o];
        let acc = layer.b[o];
        for (let i = 0; i < row.length; i++) acc += row[i] * prev[i];
        z[o] = acc;
      }
      zs.push(z);
      acts.push(ACTIVATIONS[layer.activation].apply(z));
    }
    return { zs, acts };
  }

  predict(x) {
    assertFiniteArray(x, 'Input vector');
    if (x.length !== this.inputSize) {
      throw new TypeError(`Input vector length ${x.length} does not match inputSize ${this.inputSize}`);
    }
    let a = x;
    for (let l = 0; l < this.layers.length; l++) {
      const layer = this.layers[l];
      const z = new Array(layer.fanOut);
      for (let o = 0; o < layer.fanOut; o++) {
        const row = layer.W[o];
        let acc = layer.b[o];
        for (let i = 0; i < row.length; i++) acc += row[i] * a[i];
        z[o] = acc;
      }
      a = ACTIVATIONS[layer.activation].apply(z);
    }
    return a;
  }

  computeLoss(X, Y, loss = this.loss) {
    if (X.length !== Y.length) throw new TypeError('X and Y must have the same number of samples');
    return evalBatchLoss(this, X, Y, loss);
  }

  backpropSample(x, y, grads, loss) {
    const { zs, acts } = this.forward(x);
    const L = this.layers.length;
    const outLayer = this.layers[L - 1];
    let delta;
    if (loss === 'crossEntropy' && outLayer.activation === 'softmax') {
      delta = LOSSES.crossEntropy.gradient(acts[L], y);
    } else {
      const g = LOSSES[loss].gradient(acts[L], y);
      const d = ACTIVATIONS[outLayer.activation].derivative(zs[L - 1], acts[L]);
      delta = new Array(g.length);
      for (let i = 0; i < g.length; i++) delta[i] = g[i] * d[i];
    }
    for (let l = L - 1; l >= 0; l--) {
      const layer = this.layers[l];
      const prev = acts[l];
      const gW = grads[l].W;
      const gb = grads[l].b;
      for (let o = 0; o < layer.fanOut; o++) {
        gb[o] += delta[o];
        const row = gW[o];
        for (let i = 0; i < prev.length; i++) row[i] += delta[o] * prev[i];
      }
      if (l > 0) {
        const below = this.layers[l - 1];
        const actDeriv = ACTIVATIONS[below.activation].derivative(zs[l - 1], acts[l]);
        const nextDelta = new Array(below.fanOut);
        for (let i = 0; i < below.fanOut; i++) {
          let acc = 0;
          for (let j = 0; j < layer.fanOut; j++) acc += layer.W[j][i] * delta[j];
          nextDelta[i] = acc * actDeriv[i];
        }
        delta = nextDelta;
      }
    }
  }

  train(X, Y, cfg = {}) {
    if (!Array.isArray(X) || !Array.isArray(Y) || X.length !== Y.length || X.length === 0) {
      throw new TypeError('Training requires non-empty X and Y arrays of equal length');
    }
    const n = X.length;
    for (let s = 0; s < n; s++) {
      assertFiniteArray(X[s], `X[${s}]`);
      assertFiniteArray(Y[s], `Y[${s}]`);
      if (X[s].length !== this.inputSize) {
        throw new TypeError(`X[${s}] length does not match inputSize ${this.inputSize}`);
      }
      if (Y[s].length !== this.layers[this.layers.length - 1].fanOut) {
        throw new TypeError(`Y[${s}] length does not match output size`);
      }
    }
    const epochs = Math.max(1, Math.floor(cfg.epochs ?? 500));
    const batchSize = Math.min(Math.max(1, Math.floor(cfg.batchSize ?? 32)), n);
    const learningRate = cfg.learningRate ?? 0.05;
    const momentum = cfg.momentum ?? 0.9;
    const rng = new SeededRNG(cfg.seed ?? 7);
    const initialLoss = this.computeLoss(X, Y);
    const velocity = this.layers.map((layer) => ({
      W: layer.W.map((row) => new Array(row.length).fill(0)),
      b: new Array(layer.b.length).fill(0)
    }));
    const lossHistory = [];
    for (let epoch = 0; epoch < epochs; epoch++) {
      let order = new Array(n).fill(0).map((_, i) => i);
      if (cfg.shuffle !== false) order = rng.shuffle(order);
      for (let start = 0; start < n; start += batchSize) {
        const end = Math.min(start + batchSize, n);
        const grads = zeroGrads(this.layers);
        for (let s = start; s < end; s++) {
          this.backpropSample(X[order[s]], Y[order[s]], grads, this.loss);
        }
        const m = end - start;
        for (let l = 0; l < this.layers.length; l++) {
          const layer = this.layers[l];
          for (let o = 0; o < layer.fanOut; o++) {
            for (let i = 0; i < layer.fanIn; i++) {
              const g = grads[l].W[o][i] / m;
              velocity[l].W[o][i] = momentum * velocity[l].W[o][i] - learningRate * g;
              layer.W[o][i] += velocity[l].W[o][i];
            }
            const gb = grads[l].b[o] / m;
            velocity[l].b[o] = momentum * velocity[l].b[o] - learningRate * gb;
            layer.b[o] += velocity[l].b[o];
          }
        }
      }
      lossHistory.push(this.computeLoss(X, Y));
    }
    return { initialLoss, finalLoss: lossHistory[lossHistory.length - 1], lossHistory };
  }

  toJSON() {
    return {
      format: 'omnieng-neural-net-v1',
      inputSize: this.inputSize,
      loss: this.loss,
      meta: this.meta,
      layers: this.layers.map((layer) => ({
        fanIn: layer.fanIn,
        fanOut: layer.fanOut,
        activation: layer.activation,
        W: layer.W.map((row) => row.slice()),
        b: layer.b.slice()
      }))
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object' || data.format !== 'omnieng-neural-net-v1') {
      throw new TypeError('Invalid neural network JSON payload');
    }
    if (!Array.isArray(data.layers) || data.layers.length === 0) {
      throw new TypeError('Neural network JSON payload has no layers');
    }
    const layers = data.layers.map((layer) => {
      if (!Array.isArray(layer.W) || !Array.isArray(layer.b) || !VALID_ACTIVATIONS.includes(layer.activation)) {
        throw new TypeError('Neural network JSON payload has an invalid layer');
      }
      const fanIn = layer.W[0].length;
      const fanOut = layer.W.length;
      if (layer.b.length !== fanOut) throw new TypeError('Neural network JSON payload has inconsistent bias size');
      return { fanIn, fanOut, activation: layer.activation, W: layer.W, b: layer.b };
    });
    const network = new NeuralNetwork({
      inputSize: data.inputSize,
      loss: data.loss,
      meta: data.meta,
      layers
    });
    return network;
  }
}

function createNetwork(config) {
  return new NeuralNetwork(config);
}

/* ------------------------------------------------------------------ */
/* Analytic gradients (batch-averaged) for gradient checking            */
/* ------------------------------------------------------------------ */
function analyticGradients(network, X, Y, loss) {
  const grads = zeroGrads(network.layers);
  const n = X.length;
  for (let s = 0; s < n; s++) network.backpropSample(X[s], Y[s], grads, loss);
  for (let l = 0; l < grads.length; l++) {
    for (let o = 0; o < grads[l].W.length; o++) {
      grads[l].b[o] /= n;
      for (let i = 0; i < grads[l].W[o].length; i++) grads[l].W[o][i] /= n;
    }
  }
  return grads;
}

/* ------------------------------------------------------------------ */
/* Numeric gradient check                                              */
/* ------------------------------------------------------------------ */
function gradientCheck(network, X, Y, options = {}) {
  if (!(network instanceof NeuralNetwork)) throw new TypeError('gradientCheck requires a NeuralNetwork');
  const eps = options.eps ?? 1e-6;
  const threshold = options.threshold ?? 1e-6;
  const loss = options.loss || network.loss;
  if (!VALID_LOSSES.includes(loss)) throw new TypeError(`Unknown loss "${loss}"`);
  const analytic = analyticGradients(network, X, Y, loss);
  const maxChecks = options.maxChecks ?? Infinity;
  let checks = 0;
  let maxAbsDiff = 0;
  const details = [];
  let done = false;
  for (let l = 0; l < network.layers.length && !done; l++) {
    const layer = network.layers[l];
    for (let o = 0; o < layer.fanOut && !done; o++) {
      for (let i = 0; i < layer.fanIn; i++) {
        if (checks >= maxChecks) {
          done = true;
          break;
        }
        const orig = layer.W[o][i];
        layer.W[o][i] = orig + eps;
        const plus = evalBatchLoss(network, X, Y, loss);
        layer.W[o][i] = orig - eps;
        const minus = evalBatchLoss(network, X, Y, loss);
        layer.W[o][i] = orig;
        const numeric = (plus - minus) / (2 * eps);
        const diff =
          Number.isFinite(analytic[l].W[o][i]) && Number.isFinite(numeric)
            ? Math.abs(analytic[l].W[o][i] - numeric)
            : Infinity;
        checks++;
        if (diff > maxAbsDiff) maxAbsDiff = diff;
        details.push({ kind: 'W', layer: l, row: o, col: i, analytic: analytic[l].W[o][i], numeric, diff });
      }
      if (checks >= maxChecks) {
        done = true;
        break;
      }
      const orig = layer.b[o];
      layer.b[o] = orig + eps;
      const plus = evalBatchLoss(network, X, Y, loss);
      layer.b[o] = orig - eps;
      const minus = evalBatchLoss(network, X, Y, loss);
      layer.b[o] = orig;
      const numeric = (plus - minus) / (2 * eps);
      const diff =
        Number.isFinite(analytic[l].b[o]) && Number.isFinite(numeric) ? Math.abs(analytic[l].b[o] - numeric) : Infinity;
      checks++;
      if (diff > maxAbsDiff) maxAbsDiff = diff;
      details.push({ kind: 'b', layer: l, row: o, analytic: analytic[l].b[o], numeric, diff });
    }
  }
  return { maxAbsDiff, passed: maxAbsDiff < threshold, threshold, checks, details };
}

/* ------------------------------------------------------------------ */
/* High-level surrogate API                                            */
/* ------------------------------------------------------------------ */
function normalizeDataset(dataset) {
  if (dataset && typeof dataset === 'object' && Array.isArray(dataset.inputs) && Array.isArray(dataset.outputs)) {
    if (dataset.inputs.length !== dataset.outputs.length || dataset.inputs.length === 0) {
      throw new TypeError('dataset.inputs and dataset.outputs must be non-empty arrays of equal length');
    }
    return { inputs: dataset.inputs, outputs: dataset.outputs };
  }
  if (Array.isArray(dataset)) {
    const inputs = [];
    const outputs = [];
    for (const row of dataset) {
      if (Array.isArray(row) && row.length === 2) {
        inputs.push(row[0]);
        outputs.push(row[1]);
      } else if (row && typeof row === 'object' && Array.isArray(row.x) && Array.isArray(row.y)) {
        inputs.push(row.x);
        outputs.push(row.y);
      } else if (row && typeof row === 'object' && Array.isArray(row.input) && Array.isArray(row.output)) {
        inputs.push(row.input);
        outputs.push(row.output);
      } else {
        throw new TypeError('Dataset rows must be [input, output] pairs or {x, y}/{input, output} objects');
      }
    }
    if (inputs.length === 0) throw new TypeError('Dataset must not be empty');
    return { inputs, outputs };
  }
  throw new TypeError('Dataset must be {inputs, outputs} or an array of [input, output] pairs');
}

function trainSurrogate(dataset, config = {}) {
  const { inputs, outputs } = normalizeDataset(dataset);
  const n = inputs.length;
  const inputSize = inputs[0].length;
  const outputSize = outputs[0].length;
  for (let s = 1; s < n; s++) {
    if (inputs[s].length !== inputSize || outputs[s].length !== outputSize) {
      throw new TypeError('All dataset rows must share consistent input and output dimensions');
    }
  }
  const hiddenUnits = config.hiddenUnits || [12];
  const network = createNetwork({
    inputSize,
    outputSize,
    hiddenUnits,
    activation: config.activation || 'tanh',
    loss: config.loss || 'mse',
    outputActivation: config.outputActivation,
    seed: config.seed ?? 7
  });
  const result = network.train(inputs, outputs, config);
  return {
    model: network,
    lossHistory: result.lossHistory,
    converged: result.finalLoss <= result.initialLoss * 0.2,
    initialLoss: result.initialLoss,
    finalLoss: result.finalLoss,
    trainingSamples: n,
    config: { ...config, hiddenUnits, inputSize, outputSize }
  };
}

function predictSurrogate(model, x) {
  if (!(model instanceof NeuralNetwork)) throw new TypeError('predictSurrogate requires a NeuralNetwork model');
  if (Array.isArray(x) && Array.isArray(x[0])) {
    return x.map((row) => model.predict(row));
  }
  return model.predict(x);
}

/* ------------------------------------------------------------------ */
/* JSON save / load of weights                                         */
/* ------------------------------------------------------------------ */
function saveModel(model, filePath) {
  if (!(model instanceof NeuralNetwork)) throw new TypeError('saveModel requires a NeuralNetwork');
  fs.writeFileSync(filePath, JSON.stringify(model.toJSON(), null, 2), 'utf8');
  return filePath;
}

function loadModel(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return NeuralNetwork.fromJSON(JSON.parse(raw));
}

const omniAI = {
  trainSurrogate,
  predictSurrogate,
  gradientCheck,
  saveModel,
  loadModel,
  NeuralNetwork,
  createNetwork,
  SeededRNG,
  ACTIVATIONS,
  LOSSES
};

module.exports = {
  NeuralNetwork,
  createNetwork,
  trainSurrogate,
  predictSurrogate,
  gradientCheck,
  saveModel,
  loadModel,
  SeededRNG,
  ACTIVATIONS,
  LOSSES,
  omniAI
};
