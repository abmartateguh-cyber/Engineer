/**
 * Validates the experimental frequency-response result before the renderer plots it.
 * The view model contains only finite numeric samples and reported margin values.
 */
'use strict';

(function attachBodeChartModel(global) {
  const MAX_POINTS = 10000;
  const SYNTHETIC_PRESETS = Object.freeze({
    synthetic_second_order: Object.freeze({
      numCoeffs: Object.freeze([144]),
      denCoeffs: Object.freeze([1, 13.2, 144])
    }),
    synthetic_actuator: Object.freeze({ numCoeffs: Object.freeze([250]), denCoeffs: Object.freeze([1, 15, 200]) }),
    synthetic_first_order: Object.freeze({ numCoeffs: Object.freeze([10]), denCoeffs: Object.freeze([45, 1]) })
  });

  function getSyntheticPreset(identifier) {
    if (!Object.prototype.hasOwnProperty.call(SYNTHETIC_PRESETS, identifier)) return null;
    const preset = SYNTHETIC_PRESETS[identifier];
    return { numCoeffs: [...preset.numCoeffs], denCoeffs: [...preset.denCoeffs] };
  }

  function failure(error) {
    return { success: false, error };
  }

  function optionalFinite(value) {
    return value === null || value === undefined || Number.isFinite(value);
  }

  function optionalPositiveFinite(value) {
    return value === null || value === undefined || (Number.isFinite(value) && value > 0);
  }

  function fromAnalyzerResult(result) {
    if (result?.validationLevel !== 'experimental' || !Array.isArray(result.bodePoints)) {
      return failure('The experimental Bode result does not contain a supported sample array.');
    }

    if (result.bodePoints.length < 2 || result.bodePoints.length > MAX_POINTS) {
      return failure(`The Bode plot requires between 2 and ${MAX_POINTS} samples.`);
    }

    if (
      !optionalFinite(result.gainMarginDb) ||
      !optionalFinite(result.phaseMarginDeg) ||
      !optionalPositiveFinite(result.gainCrossoverFreq) ||
      !optionalPositiveFinite(result.phaseCrossoverFreq)
    ) {
      return failure('The Bode result contains invalid margin values.');
    }

    const frequencies = [];
    const magnitudeDB = [];
    const phaseDeg = [];
    let previousFrequency = 0;

    for (const point of result.bodePoints) {
      if (
        !point ||
        !Number.isFinite(point.omegaRadS) ||
        point.omegaRadS <= previousFrequency ||
        !Number.isFinite(point.magnitudeDb) ||
        !Number.isFinite(point.phaseDeg)
      ) {
        return failure('The Bode result must contain finite samples at strictly increasing positive frequencies.');
      }

      frequencies.push(point.omegaRadS);
      magnitudeDB.push(point.magnitudeDb);
      phaseDeg.push(point.phaseDeg);
      previousFrequency = point.omegaRadS;
    }

    return {
      success: true,
      frequencies,
      magnitudeDB,
      phaseDeg,
      gainMarginDb: Number.isFinite(result.gainMarginDb) ? result.gainMarginDb : null,
      phaseMarginDeg: Number.isFinite(result.phaseMarginDeg) ? result.phaseMarginDeg : null,
      gainCrossoverFreqRadS: Number.isFinite(result.gainCrossoverFreq) ? result.gainCrossoverFreq : null,
      phaseCrossoverFreqRadS: Number.isFinite(result.phaseCrossoverFreq) ? result.phaseCrossoverFreq : null
    };
  }

  function render(result, documentRef, chartContainer, summaryContainer) {
    if (!chartContainer || !documentRef?.createElementNS || !documentRef?.createElement) {
      return failure('The Bode chart container is unavailable.');
    }

    const model = fromAnalyzerResult(result);
    if (!model.success) {
      chartContainer.textContent = model.error;
      if (summaryContainer) summaryContainer.textContent = 'No margin values are available.';
      return model;
    }

    const { frequencies, magnitudeDB, phaseDeg } = model;
    const width = 820;
    const magnitudeHeight = 160;
    const phaseHeight = 160;
    const paddingLeft = 60;
    const paddingRight = 30;
    const paddingTop = 25;
    const paddingBottom = 25;
    const plotWidth = width - paddingLeft - paddingRight;
    const logMin = Math.log10(frequencies[0]);
    const logMax = Math.log10(frequencies[frequencies.length - 1]);
    const mapX = (frequency) => paddingLeft + ((Math.log10(frequency) - logMin) / (logMax - logMin)) * plotWidth;
    const mapMagnitudeY = (db) =>
      paddingTop + (1 - (Math.max(-60, Math.min(40, db)) + 60) / 100) * (magnitudeHeight - paddingTop - paddingBottom);
    const mapPhaseY = (degrees) =>
      magnitudeHeight +
      20 +
      paddingTop +
      (1 - (Math.max(-270, Math.min(0, degrees)) + 270) / 270) * (phaseHeight - paddingTop - paddingBottom);

    const svgNamespace = 'http://www.w3.org/2000/svg';
    const svg = documentRef.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('class', 'bode-plot-svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '370');
    svg.setAttribute('viewBox', `0 0 ${width} 370`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Experimental Bode magnitude and phase response');

    const appendSvg = (tagName, attributes, text = undefined) => {
      const element = documentRef.createElementNS(svgNamespace, tagName);
      for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, String(value));
      }
      if (text !== undefined) element.textContent = text;
      svg.appendChild(element);
      return element;
    };

    const zeroDbY = mapMagnitudeY(0);
    const minus180Y = mapPhaseY(-180);
    appendSvg('text', { x: paddingLeft, y: 16, fill: '#38bdf8', 'font-weight': '700' }, 'Magnitude (dB)');
    appendSvg('line', {
      x1: paddingLeft,
      y1: paddingTop,
      x2: paddingLeft,
      y2: magnitudeHeight - paddingBottom,
      stroke: '#475569',
      'stroke-width': 1.5
    });
    appendSvg('line', {
      x1: paddingLeft,
      y1: zeroDbY,
      x2: width - paddingRight,
      y2: zeroDbY,
      class: 'bode-axis-line',
      stroke: '#64748b',
      'stroke-dasharray': '4,2'
    });
    appendSvg('text', { x: paddingLeft - 32, y: zeroDbY + 3, fill: '#94a3b8' }, '0 dB');
    appendSvg('polyline', {
      points: frequencies
        .map((frequency, index) => `${mapX(frequency).toFixed(1)},${mapMagnitudeY(magnitudeDB[index]).toFixed(1)}`)
        .join(' '),
      class: 'bode-curve-mag'
    });

    appendSvg(
      'text',
      { x: paddingLeft, y: magnitudeHeight + 32, fill: '#10b981', 'font-weight': '700' },
      'Phase (degrees)'
    );
    appendSvg('line', {
      x1: paddingLeft,
      y1: magnitudeHeight + 20 + paddingTop,
      x2: paddingLeft,
      y2: magnitudeHeight + 20 + phaseHeight - paddingBottom,
      stroke: '#475569',
      'stroke-width': 1.5
    });
    appendSvg('line', {
      x1: paddingLeft,
      y1: minus180Y,
      x2: width - paddingRight,
      y2: minus180Y,
      class: 'bode-axis-line',
      stroke: '#ef4444',
      'stroke-dasharray': '4,2'
    });
    appendSvg('text', { x: paddingLeft - 38, y: minus180Y + 3, fill: '#ef4444' }, '-180°');
    appendSvg('polyline', {
      points: frequencies
        .map((frequency, index) => `${mapX(frequency).toFixed(1)},${mapPhaseY(phaseDeg[index]).toFixed(1)}`)
        .join(' '),
      class: 'bode-curve-phase'
    });

    const firstDecade = Math.ceil(logMin);
    const lastDecade = Math.floor(logMax);
    const decadeSpan = Math.max(1, lastDecade - firstDecade + 1);
    const decadeStep = Math.max(1, Math.ceil(decadeSpan / 8));
    const ticks = [];
    for (let exponent = firstDecade; exponent <= lastDecade; exponent += decadeStep) {
      const tick = 10 ** exponent;
      if (tick >= frequencies[0] && tick <= frequencies[frequencies.length - 1]) ticks.push(tick);
    }
    if (ticks.length < 2) ticks.push(frequencies[0], frequencies[frequencies.length - 1]);
    for (const tick of [...new Set(ticks)]) {
      const label = Number(tick.toPrecision(3)).toString();
      appendSvg('text', { x: mapX(tick), y: 365, fill: '#64748b', 'text-anchor': 'middle' }, `${label} rad/s`);
    }

    chartContainer.replaceChildren(svg);

    if (summaryContainer) {
      const card = documentRef.createElement('div');
      card.className = 'telemetry-card bode-metrics-card';
      const grid = documentRef.createElement('div');
      grid.className = 'bode-metrics-grid';
      card.appendChild(grid);

      const formatMetric = (value, suffix) =>
        Number.isFinite(value) ? `${Number(value.toPrecision(5))}${suffix}` : 'Unavailable';
      const appendMetric = (label, value) => {
        const row = documentRef.createElement('div');
        row.className = 'telemetry-row bode-metric-row';
        const labelElement = documentRef.createElement('span');
        labelElement.className = 'telemetry-label';
        labelElement.textContent = label;
        const valueElement = documentRef.createElement('span');
        valueElement.className = 'telemetry-value bode-metric-value';
        valueElement.textContent = value;
        row.appendChild(labelElement);
        row.appendChild(valueElement);
        grid.appendChild(row);
      };

      appendMetric('Gain Margin (experimental)', formatMetric(model.gainMarginDb, ' dB'));
      appendMetric('Phase Margin (experimental)', formatMetric(model.phaseMarginDeg, '°'));
      appendMetric('Phase Crossover Frequency', formatMetric(model.phaseCrossoverFreqRadS, ' rad/s'));
      appendMetric('Gain Crossover Frequency', formatMetric(model.gainCrossoverFreqRadS, ' rad/s'));

      const note = documentRef.createElement('div');
      note.className = 'status-indicator status-warn bode-metrics-note';
      note.textContent =
        'Margins use sampled crossover estimates without interpolation or refinement. No closed-loop stability verdict or bandwidth is calculated. These frequency-response estimates have not been independently validated.';
      card.appendChild(note);
      summaryContainer.replaceChildren(card);
    }

    return { success: true };
  }

  const api = Object.freeze({ fromAnalyzerResult, getSyntheticPreset, render });
  if (global) global.OmniBodeChartModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
