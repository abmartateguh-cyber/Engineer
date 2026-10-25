/**
 * Experimental waveform viewer for results returned by the local SPICE path.
 * It does not create example traces or claim simulator or instrument conformance.
 */

'use strict';

class SpiceOscilloscopeUI {
  constructor(containerId, solveCircuit) {
    this.container = document.getElementById(containerId);
    this.solveCircuit = solveCircuit;
    this.canvas = null;
    this.ctx = null;
    this.waveforms = [];
    this.hoverTime = null;
    this.maxTimeMs = 0;
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="oscilloscope-layout" style="display:flex;flex-direction:column;gap:12px;color:var(--text-main);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <div style="background:#0c1220;padding:10px 14px;border-radius:6px;border:1px solid var(--border-color);">
          <div style="font-weight:700;color:var(--accent-cyan);font-size:13px;">Experimental SPICE waveform viewer</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:5px;">Provide an explicit transient request in SI units. This path is experimental and has not passed independent accuracy or convergence review.</div>
        </div>
        <form id="spice-request-form" style="display:flex;flex-direction:column;gap:8px;">
          <label for="spice-request-json" style="font-size:12px;font-weight:600;">Circuit and analysis JSON</label>
          <textarea id="spice-request-json" rows="9" spellcheck="false" aria-describedby="spice-request-help" style="width:100%;box-sizing:border-box;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;background:#080d18;color:var(--text-main);border:1px solid var(--border-color);border-radius:5px;padding:10px;resize:vertical;"></textarea>
          <div id="spice-request-help" style="font-size:11px;line-height:1.5;color:var(--text-muted);">
            Required: <code>analysis</code> with <code>type</code>, <code>stopTimeS</code>, <code>stepS</code>, plus a <code>components</code> array. Supported components: <code>resistor</code> (id, n1, n2, resistanceOhm), <code>capacitor</code> (id, n1, n2, capacitanceF, initialVoltageV), <code>inductor</code> (id, n1, n2, inductanceH, initialCurrentA), <code>voltage_source</code> (id, nPlus, nMinus, dcVoltageV, optional waveform), and <code>current_source</code> (id, nFrom, nTo, currentA). Use node <code>0</code> for ground. Voltage waveforms require explicit STEP, SINE, or PULSE values. Limits: 24 components, 12 MNA unknowns, and 2,000 time steps.
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <button type="submit" class="btn-primary" id="spice-run-button">Run experimental transient</button>
            <span id="spice-run-status" role="status" aria-live="polite" style="font-size:11px;color:var(--text-muted);">No solve has been run.</span>
          </div>
        </form>
        <div id="spice-result-panel" hidden style="display:flex;flex-direction:column;gap:10px;">
          <div id="spice-maturity-warning" class="status-indicator status-warn">Experimental solver output; no independent accuracy, convergence, or manufacturing validation is available.</div>
          <div id="spice-node-legend" style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px;font-weight:600;"></div>
          <div style="background:#020408;border:2px solid #1e293b;border-radius:8px;padding:10px;">
            <canvas id="canvas-oscilloscope-screen" width="780" height="320" style="width:100%;height:320px;background:#030712;border-radius:4px;display:block;cursor:crosshair;"></canvas>
            <div id="scope-cursor-readout" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-top:6px;font-size:11px;color:var(--text-muted);font-family:monospace;"></div>
          </div>
          <div id="spice-run-summary" style="font-size:11px;color:var(--text-muted);"></div>
          <div id="spice-run-warnings" style="font-size:11px;color:var(--warn);"></div>
        </div>
      </div>`;

    this.canvas = this.container.querySelector('#canvas-oscilloscope-screen');
    this.ctx = this.canvas?.getContext('2d') || null;
    this._setupCanvas();
    this.container
      .querySelector('#spice-request-form')
      ?.addEventListener('submit', (event) => this._submitRequest(event));
  }

  async _submitRequest(event) {
    event.preventDefault();
    const status = this.container.querySelector('#spice-run-status');
    const button = this.container.querySelector('#spice-run-button');
    const input = this.container.querySelector('#spice-request-json');
    if (!this.solveCircuit) {
      status.textContent = 'The SPICE service is unavailable.';
      return;
    }

    let request;
    try {
      request = JSON.parse(input.value);
    } catch (error) {
      status.textContent = `Invalid JSON: ${error.message}`;
      return;
    }

    button.disabled = true;
    status.textContent = 'Running the experimental transient solver…';
    try {
      this.renderResult(await this.solveCircuit(request));
    } catch (error) {
      this._showFailure(error?.message || 'The SPICE service failed.');
    } finally {
      button.disabled = false;
    }
  }

  renderResult(result) {
    if (!result?.success || !result.transient) {
      this._showFailure(result?.error?.message || 'No transient result was returned.');
      return;
    }

    const times = result.transient.time;
    const nodeSamples = result.transient.nodes;
    if (!Array.isArray(times) || !nodeSamples || typeof nodeSamples !== 'object') {
      this._showFailure('The service returned a result with an unsupported waveform shape.');
      return;
    }

    const colors = ['#facc15', '#00e5ff', '#ec4899', '#a78bfa', '#34d399', '#fb923c', '#60a5fa'];
    this.waveforms = Object.entries(nodeSamples)
      .filter(([node]) => node !== '0')
      .map(([name, samples], index) => ({
        name,
        color: colors[index % colors.length],
        points: Array.isArray(samples)
          ? samples.slice(0, times.length).map((value, sampleIndex) => ({ t: times[sampleIndex], v: value }))
          : []
      }))
      .filter(
        (waveform) =>
          waveform.points.length > 0 &&
          waveform.points.every((point) => Number.isFinite(point.t) && Number.isFinite(point.v))
      );
    this.maxTimeMs = Math.max(0, ...times.filter(Number.isFinite));
    if (this.waveforms.length === 0 || this.maxTimeMs <= 0) {
      this._showFailure('The service returned no plottable non-ground node samples.');
      return;
    }

    const status = this.container.querySelector('#spice-run-status');
    status.textContent = 'Experimental result returned. Review the warning before interpreting it.';
    this.container.querySelector('#spice-result-panel').hidden = false;
    this._renderLegend();
    this._renderSummary(result, times.length);
    this._renderWarnings(result.warnings);
    this._drawGraticuleAndTraces();
    this._updateCursorReadout(this.hoverTime ?? 0);
  }

  _showFailure(message) {
    const status = this.container.querySelector('#spice-run-status');
    status.textContent = `No result: ${message}`;
    this.container.querySelector('#spice-result-panel').hidden = true;
    this.waveforms = [];
    this.maxTimeMs = 0;
    this._drawGraticuleAndTraces();
  }

  _renderLegend() {
    const legend = this.container.querySelector('#spice-node-legend');
    legend.replaceChildren();
    for (const waveform of this.waveforms) {
      const label = document.createElement('span');
      label.style.color = waveform.color;
      label.textContent = `Node ${waveform.name} (V)`;
      legend.append(label);
    }
  }

  _renderSummary(result, sampleCount) {
    const stepMs = result.analysis?.stepS * 1000;
    const summary = this.container.querySelector('#spice-run-summary');
    const details = [
      `${sampleCount} returned samples`,
      `${this.waveforms.length} node voltage traces`,
      `end time ${this.maxTimeMs.toFixed(4)} ms`
    ];
    if (Number.isFinite(stepMs)) details.push(`requested time step ${stepMs} ms`);
    summary.textContent = details.join(' · ');
  }

  _renderWarnings(warnings) {
    const warningContainer = this.container.querySelector('#spice-run-warnings');
    const safeWarnings = Array.isArray(warnings) ? warnings.filter((warning) => typeof warning === 'string') : [];
    warningContainer.textContent = safeWarnings.join(' ');
  }

  _setupCanvas() {
    if (!this.canvas) return;
    this.canvas.addEventListener('mousemove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
      this.hoverTime = Math.max(0, Math.min(1, fraction)) * this.maxTimeMs;
      this._updateCursorReadout(this.hoverTime);
      this._drawGraticuleAndTraces();
    });
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverTime = null;
      this._updateCursorReadout(0);
      this._drawGraticuleAndTraces();
    });
  }

  _valueAt(waveform, timeMs) {
    const points = waveform.points;
    if (points.length === 1 || timeMs <= points[0].t) return points[0].v;
    for (let index = 1; index < points.length; index++) {
      const right = points[index];
      if (right.t >= timeMs) {
        const left = points[index - 1];
        const span = right.t - left.t;
        if (span <= 0) return right.v;
        const fraction = (timeMs - left.t) / span;
        return left.v + fraction * (right.v - left.v);
      }
    }
    return points[points.length - 1].v;
  }

  _updateCursorReadout(timeMs) {
    const readout = this.container?.querySelector('#scope-cursor-readout');
    if (!readout) return;
    readout.replaceChildren();
    const timeLabel = document.createElement('span');
    timeLabel.textContent = `Time: ${timeMs.toFixed(4)} ms`;
    readout.append(timeLabel);
    for (const waveform of this.waveforms) {
      const valueLabel = document.createElement('span');
      valueLabel.style.color = waveform.color;
      valueLabel.textContent = `${waveform.name}: ${this._valueAt(waveform, timeMs).toFixed(6)} V`;
      readout.append(valueLabel);
    }
  }

  _drawGraticuleAndTraces() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let index = 0; index <= 10; index++) {
      const x = (index * width) / 10;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let index = 0; index <= 8; index++) {
      const y = (index * height) / 8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const points = this.waveforms.flatMap((waveform) => waveform.points);
    if (points.length === 0 || this.maxTimeMs <= 0) return;
    let minV = Math.min(...points.map((point) => point.v));
    let maxV = Math.max(...points.map((point) => point.v));
    if (maxV === minV) {
      const padding = Math.max(1, Math.abs(maxV) * 0.1);
      minV -= padding;
      maxV += padding;
    } else {
      const padding = (maxV - minV) * 0.08;
      minV -= padding;
      maxV += padding;
    }

    for (const waveform of this.waveforms) {
      ctx.strokeStyle = waveform.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      waveform.points.forEach((point, index) => {
        const x = (point.t / this.maxTimeMs) * width;
        const y = height - ((point.v - minV) / (maxV - minV)) * height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    if (this.hoverTime !== null) {
      const x = (this.hoverTime / this.maxTimeMs) * width;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

if (typeof window !== 'undefined') window.SpiceOscilloscopeUI = SpiceOscilloscopeUI;
if (typeof module !== 'undefined' && module.exports) module.exports = { SpiceOscilloscopeUI };
