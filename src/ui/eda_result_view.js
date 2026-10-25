/**
 * DOM-only views for caller-driven experimental EDA result metrics.
 */
'use strict';

(function attachEdaResultView(global) {
  function failure(error) {
    return { success: false, error };
  }

  function formatCount(value, suffix = '') {
    return Number.isSafeInteger(value) && value >= 0 ? `${value}${suffix}` : 'Unavailable';
  }

  function formatMetric(value, suffix = '') {
    return Number.isFinite(value) ? `${value}${suffix}` : 'Unavailable';
  }

  function renderCard(documentRef, container, metrics, note) {
    if (!container || !documentRef?.createElement || typeof container.replaceChildren !== 'function') {
      return failure('The EDA result container is unavailable.');
    }

    const card = documentRef.createElement('div');
    card.className = 'telemetry-card';
    for (const [label, value] of metrics) {
      const row = documentRef.createElement('div');
      row.className = 'telemetry-row';
      const labelElement = documentRef.createElement('span');
      labelElement.className = 'telemetry-label';
      labelElement.textContent = label;
      const valueElement = documentRef.createElement('span');
      valueElement.className = 'telemetry-value';
      valueElement.textContent = value;
      row.appendChild(labelElement);
      row.appendChild(valueElement);
      card.appendChild(row);
    }

    const noteElement = documentRef.createElement('div');
    noteElement.className = 'status-indicator status-warn';
    noteElement.textContent = note;
    card.appendChild(noteElement);
    container.replaceChildren(card);
    return { success: true };
  }

  function renderVerilogResult(result, documentRef, container) {
    if (result?.success !== true) return failure('No successful Verilog inspection result was returned.');

    return renderCard(
      documentRef,
      container,
      [
        ['Parsed toy gates', formatCount(result.gateCount, ' Gates')],
        ['Illustrative area', formatMetric(result.totalArea_um2, ' µm²')],
        ['Serial gate-delay sum', formatMetric(result.serialGateDelayEstimate_ps, ' ps (illustrative)')],
        ['Maximum frequency', 'Not calculated'],
        ['Timing slack', 'Not calculated']
      ],
      'Illustrative parser output only. Gate values are uncharacterized; no target library, timing graph, clock constraint, or physical timing result is configured.'
    );
  }

  function renderDrcResult(result, documentRef, container) {
    if (result?.success !== true) return failure('No successful rectangle-screen result was returned.');

    const status =
      typeof result.clean !== 'boolean'
        ? 'Rule-screen status unavailable.'
        : result.clean
          ? 'No violations were flagged by the supplied rectangle rules.'
          : 'The supplied rectangle rules flagged one or more violations.';

    return renderCard(
      documentRef,
      container,
      [
        ['Caller rectangles checked', formatCount(result.totalShapesChecked)],
        ['Rectangle rule flags', formatCount(result.violationCount)]
      ],
      `${status} Experimental rectangle screen only; no process-specific rule deck or signoff is provided.`
    );
  }

  const api = Object.freeze({ renderDrcResult, renderVerilogResult });
  if (global) global.OmniEdaResultView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
