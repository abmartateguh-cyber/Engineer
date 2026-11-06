/**
 * Experimental HPC local dispatch panel.
 *
 * Submits a sparse Poisson solve task (N input) via omni:hpc-local-dispatch and
 * shows the recorded queued → running → completed transitions plus the verified
 * residual and checksum. DOM-only: no innerHTML, no inline scripts, no
 * randomness.
 */
'use strict';

(function attachHpcLocalDispatchView(global) {
  function renderTransitions(documentRef, container, transitions) {
    const list = Array.isArray(transitions) ? transitions : [];
    container.replaceChildren();
    if (list.length === 0) {
      const empty = documentRef.createElement('div');
      empty.className = 'telemetry-row';
      empty.textContent = 'No transitions were recorded.';
      container.appendChild(empty);
      return { success: true };
    }
    for (const transition of list) {
      const row = documentRef.createElement('div');
      row.className = 'telemetry-row hpc-transition';
      const label = documentRef.createElement('span');
      label.className = 'telemetry-label';
      label.textContent = `${transition.from || 'null'} → ${transition.to}`;
      const value = documentRef.createElement('span');
      value.className = 'telemetry-value';
      value.textContent = `${transition.event} · ${String(transition.at || '').slice(11, 19)}`;
      row.appendChild(label);
      row.appendChild(value);
      container.appendChild(row);
    }
    return { success: true };
  }

  function appendRow(documentRef, container, label, value) {
    const row = documentRef.createElement('div');
    row.className = 'telemetry-row';
    const labelElement = documentRef.createElement('span');
    labelElement.className = 'telemetry-label';
    labelElement.textContent = label;
    const valueElement = documentRef.createElement('span');
    valueElement.className = 'telemetry-value';
    valueElement.textContent = String(value);
    row.appendChild(labelElement);
    row.appendChild(valueElement);
    container.appendChild(row);
  }

  function renderResult(documentRef, container, response) {
    if (!container) return { success: false, error: 'Result container unavailable.' };
    container.replaceChildren();
    if (!response || response.success !== true) {
      const error = documentRef.createElement('div');
      error.className = 'status-indicator status-warn';
      error.textContent = response?.error?.message || 'Dispatch failed or returned no success flag.';
      container.appendChild(error);
      return { success: true };
    }
    appendRow(documentRef, container, 'Job', response.jobId || 'unknown');
    appendRow(documentRef, container, 'Status', response.status || 'unknown');
    appendRow(documentRef, container, 'Scheduler', `${response.provider || ''} · ${response.scheduler || ''}`);

    const result = response.result || {};
    appendRow(
      documentRef,
      container,
      'Relative residual',
      typeof result.relativeResidual === 'number' ? result.relativeResidual.toExponential(3) : 'Unavailable'
    );
    appendRow(
      documentRef,
      container,
      'Checksum (SHA-256)',
      typeof result.checksum === 'string' ? result.checksum.slice(0, 16) + '…' : 'Unavailable'
    );
    appendRow(
      documentRef,
      container,
      'Iterations / converged',
      `${result.iterations ?? '?'} / ${result.converged === true ? 'yes' : 'no'}`
    );
    if (typeof response.executionDurationMs === 'number') {
      appendRow(documentRef, container, 'Execution', `${response.executionDurationMs} ms`);
    }
    return { success: true };
  }

  function mount(documentRef, root, api, options = {}) {
    if (!root || !documentRef?.createElement) return { success: false, error: 'HPC panel root unavailable.' };
    const defaultN = Number.isInteger(options.defaultN) && options.defaultN >= 8 ? options.defaultN : 32;

    const panel = documentRef.createElement('div');
    panel.className = 'param-group hpc-dispatch-panel';

    const title = documentRef.createElement('div');
    title.className = 'param-group-title';
    title.textContent = 'HPC Local Dispatch (experimental)';
    panel.appendChild(title);

    const inputRow = documentRef.createElement('div');
    inputRow.className = 'param-row';
    const label = documentRef.createElement('label');
    label.className = 'param-label-row';
    label.textContent = 'Sparse Poisson grid N';
    const input = documentRef.createElement('input');
    input.type = 'number';
    input.className = 'text-input';
    input.min = '8';
    input.max = '512';
    input.step = '1';
    input.value = String(defaultN);
    const button = documentRef.createElement('button');
    button.type = 'button';
    button.className = 'btn-primary';
    button.textContent = 'Dispatch';
    inputRow.appendChild(label);
    inputRow.appendChild(input);
    inputRow.appendChild(button);
    panel.appendChild(inputRow);

    const transitionsContainer = documentRef.createElement('div');
    transitionsContainer.className = 'hpc-transitions';
    panel.appendChild(transitionsContainer);

    const status = documentRef.createElement('div');
    status.className = 'status-indicator status-warn';
    status.textContent = 'No task dispatched yet.';
    panel.appendChild(status);

    const resultsContainer = documentRef.createElement('div');
    resultsContainer.className = 'hpc-results';
    panel.appendChild(resultsContainer);

    const note = documentRef.createElement('div');
    note.className = 'status-indicator status-warn';
    note.textContent = 'Experimental: local multiprocess dispatcher with independent residual/checksum verification.';
    panel.appendChild(note);

    root.replaceChildren(panel);

    function dispatch() {
      const n = Number(input.value);
      if (!Number.isInteger(n) || n < 8 || n > 512) {
        status.textContent = 'N must be an integer from 8 to 512.';
        return;
      }
      if (!api || typeof api.hpcLocalDispatch !== 'function') {
        status.textContent = 'HPC local dispatch IPC route is unavailable in this build.';
        return;
      }
      status.textContent = 'Dispatching…';
      api.hpcLocalDispatch({ n }).then(
        (response) => {
          status.textContent = response.success === true ? 'Dispatch completed.' : 'Dispatch failed.';
          renderTransitions(documentRef, transitionsContainer, response?.transitions);
          renderResult(documentRef, resultsContainer, response);
        },
        () => {
          status.textContent = 'Dispatch failed; check the renderer console.';
        }
      );
    }

    button.addEventListener('click', dispatch);
    return { success: true };
  }

  const api = Object.freeze({
    renderTransitions,
    renderResult,
    mount
  });
  if (global) global.OmniHpcLocalDispatchView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
