/**
 * Experimental AI surrogate trainer panel.
 *
 * Parses a small CSV-ish textarea (x1,x2,y rows), trains a genuine seeded MLP
 * surrogate via omni:ai-train-surrogate, draws the loss history as an SVG
 * polyline, and predicts for an input pair via omni:ai-predict-surrogate.
 * DOM-only: no innerHTML, no inline scripts, no randomness.
 */
'use strict';

(function attachAiSurrogateTrainerView(global) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LOSS_WIDTH = 340;
  const LOSS_HEIGHT = 150;
  const LOSS_MARGIN = 24;

  function parseCsv(text) {
    if (typeof text !== 'string') return { success: false, error: 'CSV text must be a string.' };
    const inputs = [];
    const outputs = [];
    const lines = text.split(/\r?\n/);
    let rowCount = 0;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const fields = line.split(',').map((field) => field.trim());
      if (fields.length < 3) {
        return { success: false, error: `Row ${rowCount + 1} must have x1,x2,y fields.` };
      }
      const values = fields.map((field) => Number(field));
      if (values.some((value) => !Number.isFinite(value))) {
        return { success: false, error: `Row ${rowCount + 1} contains a non-finite value.` };
      }
      inputs.push([values[0], values[1]]);
      outputs.push([values[2]]);
      rowCount++;
    }
    if (rowCount < 2) {
      return { success: false, error: 'Provide at least two data rows.' };
    }
    return { success: true, inputs, outputs, rowCount };
  }

  function buildLossLineModel(lossHistory) {
    const list = Array.isArray(lossHistory) ? lossHistory : [];
    const finite = list.filter((value) => typeof value === 'number' && Number.isFinite(value));
    if (finite.length < 2) return { success: false, points: [] };
    let minLoss = Infinity;
    let maxLoss = -Infinity;
    for (const value of finite) {
      minLoss = Math.min(minLoss, value);
      maxLoss = Math.max(maxLoss, value);
    }
    const pad = Math.max((maxLoss - minLoss) * 0.1, 1e-9);
    const lossMin = minLoss - pad;
    const lossMax = maxLoss + pad;
    const points = finite.map((value, index) => ({
      epoch: index,
      loss: value,
      x: LOSS_MARGIN + (index / (finite.length - 1)) * (LOSS_WIDTH - 2 * LOSS_MARGIN),
      y: LOSS_HEIGHT - LOSS_MARGIN - ((value - lossMin) / (lossMax - lossMin || 1)) * (LOSS_HEIGHT - 2 * LOSS_MARGIN)
    }));
    return { success: true, points, minLoss: lossMin, maxLoss: lossMax };
  }

  function renderLossSvg(documentRef, svgContainer, lossModel) {
    if (!svgContainer || !documentRef?.createElementNS) return { success: false, error: 'SVG container unavailable.' };
    const svg = documentRef.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${LOSS_WIDTH} ${LOSS_HEIGHT}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.className = 'ai-loss-svg';

    if (!lossModel || lossModel.success !== true || lossModel.points.length < 2) {
      svg.setAttribute('data-empty', 'true');
      svgContainer.replaceChildren(svg);
      return { success: true, empty: true };
    }

    const polyline = documentRef.createElementNS(SVG_NS, 'polyline');
    polyline.setAttribute(
      'points',
      lossModel.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
    );
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', 'var(--accent-green, #22c55e)');
    polyline.setAttribute('stroke-width', '2');
    svg.appendChild(polyline);

    const firstLabel = documentRef.createElementNS(SVG_NS, 'text');
    firstLabel.setAttribute('x', String(LOSS_MARGIN));
    firstLabel.setAttribute('y', String(LOSS_HEIGHT - 6));
    firstLabel.textContent = `epoch 0 · ${lossModel.maxLoss.toExponential(3)}`;
    svg.appendChild(firstLabel);

    const lastLabel = documentRef.createElementNS(SVG_NS, 'text');
    lastLabel.setAttribute('x', String(LOSS_WIDTH - LOSS_MARGIN - 96));
    lastLabel.setAttribute('y', String(LOSS_HEIGHT - 6));
    lastLabel.textContent = `epoch ${lossModel.points.length - 1} · ${lossModel.minLoss.toExponential(3)}`;
    svg.appendChild(lastLabel);

    svgContainer.replaceChildren(svg);
    return { success: true };
  }

  function parsePredictInput(x1, x2) {
    const values = [Number(x1), Number(x2)];
    if (values.some((value) => !Number.isFinite(value))) {
      return { success: false, error: 'Prediction inputs must be finite numbers.' };
    }
    return { success: true, input: values };
  }

  function mount(documentRef, root, api, options = {}) {
    if (!root || !documentRef?.createElement) return { success: false, error: 'Surrogate panel root unavailable.' };
    let trainedModel = null;

    const panel = documentRef.createElement('div');
    panel.className = 'param-group ai-surrogate-panel';

    const title = documentRef.createElement('div');
    title.className = 'param-group-title';
    title.textContent = 'AI Surrogate Trainer (experimental)';
    panel.appendChild(title);

    const textarea = documentRef.createElement('textarea');
    textarea.className = 'text-input ai-csv-input';
    textarea.rows = '5';
    textarea.spellcheck = false;
    textarea.placeholder = 'x1,x2,y\n0,0,0\n1,0,1\n0,1,1\n1,1,2';
    textarea.value = options.defaultCsv || '0,0,0\n1,0,1\n0,1,1\n1,1,2\n2,1,3';
    panel.appendChild(textarea);

    const trainButton = documentRef.createElement('button');
    trainButton.type = 'button';
    trainButton.className = 'btn-primary';
    trainButton.textContent = 'Train surrogate';
    panel.appendChild(trainButton);

    const status = documentRef.createElement('div');
    status.className = 'status-indicator status-warn';
    status.textContent = 'Not trained.';
    panel.appendChild(status);

    const lossContainer = documentRef.createElement('div');
    lossContainer.className = 'ai-loss-chart';
    panel.appendChild(lossContainer);

    const predictRow = documentRef.createElement('div');
    predictRow.className = 'param-row';
    const x1Input = documentRef.createElement('input');
    x1Input.type = 'number';
    x1Input.className = 'text-input';
    x1Input.placeholder = 'x1';
    const x2Input = documentRef.createElement('input');
    x2Input.type = 'number';
    x2Input.className = 'text-input';
    x2Input.placeholder = 'x2';
    const predictButton = documentRef.createElement('button');
    predictButton.type = 'button';
    predictButton.className = 'btn-primary';
    predictButton.textContent = 'Predict';
    predictRow.appendChild(x1Input);
    predictRow.appendChild(x2Input);
    predictRow.appendChild(predictButton);
    panel.appendChild(predictRow);

    const predictOutput = documentRef.createElement('div');
    predictOutput.className = 'ai-predict-output';
    panel.appendChild(predictOutput);

    const note = documentRef.createElement('div');
    note.className = 'status-indicator status-warn';
    note.textContent = 'Experimental: seeded MLP training on caller-supplied rows; no independent validation.';
    panel.appendChild(note);

    root.replaceChildren(panel);

    function train() {
      const parsed = parseCsv(textarea.value);
      if (parsed.success !== true) {
        status.textContent = parsed.error;
        return;
      }
      if (!api || typeof api.aiTrainSurrogate !== 'function') {
        status.textContent = 'Surrogate train IPC route is unavailable in this build.';
        return;
      }
      status.textContent = 'Training…';
      api.aiTrainSurrogate({ dataset: { inputs: parsed.inputs, outputs: parsed.outputs } }).then(
        (response) => {
          if (response?.success !== true || !response.model) {
            status.textContent = response?.error?.message || 'Training failed.';
            return;
          }
          trainedModel = response.model;
          const initialLoss = typeof response.initialLoss === 'number' ? response.initialLoss.toExponential(3) : 'n/a';
          const finalLoss = typeof response.finalLoss === 'number' ? response.finalLoss.toExponential(3) : 'n/a';
          status.textContent = `Trained: ${parsed.rowCount} rows · initial ${initialLoss} → final ${finalLoss} · converged ${response.converged === true ? 'yes' : 'no'}`;
          renderLossSvg(documentRef, lossContainer, buildLossLineModel(response.lossHistory));
        },
        () => {
          status.textContent = 'Training failed; check the renderer console.';
        }
      );
    }

    function predict() {
      if (!trainedModel) {
        predictOutput.textContent = 'Train a surrogate before predicting.';
        return;
      }
      if (!api || typeof api.aiPredictSurrogate !== 'function') {
        predictOutput.textContent = 'Surrogate predict IPC route is unavailable in this build.';
        return;
      }
      const parsed = parsePredictInput(x1Input.value, x2Input.value);
      if (parsed.success !== true) {
        predictOutput.textContent = parsed.error;
        return;
      }
      api.aiPredictSurrogate({ model: trainedModel, x: [parsed.input] }).then(
        (response) => {
          if (response?.success !== true || !Array.isArray(response.predictions)) {
            predictOutput.textContent = response?.error?.message || 'Prediction failed.';
            return;
          }
          const value = response.predictions[0]?.[0];
          predictOutput.textContent =
            typeof value === 'number' && Number.isFinite(value) ? `y ≈ ${value.toFixed(4)}` : 'Prediction unavailable';
        },
        () => {
          predictOutput.textContent = 'Prediction failed; check the renderer console.';
        }
      );
    }

    trainButton.addEventListener('click', train);
    predictButton.addEventListener('click', predict);
    return { success: true };
  }

  const api = Object.freeze({
    parseCsv,
    buildLossLineModel,
    renderLossSvg,
    parsePredictInput,
    mount
  });
  if (global) global.OmniAiSurrogateTrainerView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
