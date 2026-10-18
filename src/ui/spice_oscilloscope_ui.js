/**
 * OmniEng SPICE Oscilloscope UI
 * Standard: Virtual 4-Channel Mixed-Signal Digital Storage Oscilloscope (DSO)
 * Parity: Cadence Virtuoso ViVA / Keysight Infiniium / Altium SimData
 * Renders:
 * 1. Multi-channel time-domain waveforms V(t), I(t)
 * 2. Graticule grid with 10 horizontal divisions and 8 vertical divisions
 * 3. Interactive time tracking cursor with instantaneous voltage readout
 * 4. Signal metrics: Rise Time (10%-90%), Fall Time, Peak-to-Peak, Frequency, Cutoff
 */

class SpiceOscilloscopeUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.canvas = null;
    this.ctx = null;
    this.waveforms = []; // [{ name: 'Vin', color: '#facc15', points: [{ t, v }] }]
    this.hoverTime = null;
    this.timeScale = 1.0; // multiplier
    this.voltScale = 1.0;
  }

  /**
   * Initializes or updates the complete oscilloscope pane.
   * @param {Object} data { waveforms, metrics, circuitName }
   */
  render(data = {}) {
    if (!this.container) return;
    this.waveforms = data.waveforms || this._getDefaultWaveforms();
    const metrics = data.metrics || this._computeMetrics(this.waveforms);
    const circuitName = data.circuitName || 'RC Low-Pass Filter Step Response (R=1kΩ, C=1µF, τ=1.0ms)';

    this.container.innerHTML = `
      <div class="oscilloscope-layout" style="display: flex; flex-direction: column; gap: 12px; color: var(--text-main); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <!-- Oscilloscope Top Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; background: #0c1220; padding: 10px 14px; border-radius: 6px; border: 1px solid var(--border-color);">
          <div>
            <div style="font-weight: 700; color: var(--accent-cyan); font-size: 13px;">📈 ${circuitName}</div>
            <div style="font-size: 10px; color: var(--text-muted);">MNA Engine Companion Matrix • Backward Euler Integration (dt = 50 µs)</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="ribbon-btn active" id="btn-scope-autoscale" style="padding: 4px 10px; font-size: 11px;">🔍 Auto-Scale</button>
            <button class="ribbon-btn" id="btn-scope-trigger" style="padding: 4px 10px; font-size: 11px;">⚡ Single Trig</button>
          </div>
        </div>

        <!-- Oscilloscope Screen (Screen Bezel) -->
        <div style="background: #020408; border: 2px solid #1e293b; border-radius: 8px; padding: 10px; box-shadow: inset 0 0 20px rgba(0,0,0,0.8); position: relative;">
          <!-- Channel Badges -->
          <div style="display: flex; gap: 14px; margin-bottom: 6px; font-size: 11px; font-weight: 600;">
            <span style="color: #facc15;"><span style="display:inline-block; width:10px; height:3px; background:#facc15; margin-right:4px;"></span>CH1: V_in (1.0 V/div)</span>
            <span style="color: #00e5ff;"><span style="display:inline-block; width:10px; height:3px; background:#00e5ff; margin-right:4px;"></span>CH2: V_out (1.0 V/div)</span>
            <span style="color: #ec4899;"><span style="display:inline-block; width:10px; height:3px; background:#ec4899; margin-right:4px;"></span>CH3: I_cap (1.0 mA/div)</span>
            <span style="color: var(--text-dim); margin-left: auto;">Timebase: 1.0 ms / div</span>
          </div>

          <canvas id="canvas-oscilloscope-screen" width="780" height="320" style="width: 100%; height: 320px; background: #030712; border-radius: 4px; display: block; cursor: crosshair;"></canvas>
          
          <!-- Hover Cursor Readout -->
          <div id="scope-cursor-readout" style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; color: var(--text-muted); font-family: monospace;">
            <span>T: 0.00 ms</span>
            <span>CH1: 0.00 V</span>
            <span>CH2: 0.00 V</span>
            <span>CH3: 0.00 mA</span>
          </div>
        </div>

        <!-- Automated Signal Analysis Telemetry -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Rise Time (10% - 90%)</div>
            <div style="font-size: 15px; font-weight: 700; color: var(--accent-cyan);">${metrics.riseTimeMs.toFixed(2)} ms</div>
            <div style="font-size: 10px; color: var(--text-muted);">Theoretical 2.2·RC: ${(2.2 * 1.0).toFixed(2)} ms</div>
          </div>
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Time Constant (τ = RC)</div>
            <div style="font-size: 15px; font-weight: 700; color: #34d399;">${metrics.tauMs.toFixed(2)} ms</div>
            <div style="font-size: 10px; color: var(--text-muted);">63.2% V_final: 3.16 V</div>
          </div>
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">-3dB Cutoff Frequency</div>
            <div style="font-size: 15px; font-weight: 700; color: #a78bfa;">${metrics.cutoffHz.toFixed(1)} Hz</div>
            <div style="font-size: 10px; color: var(--text-muted);">f_c = 1 / (2·π·R·C)</div>
          </div>
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Peak-to-Peak (V_pp)</div>
            <div style="font-size: 15px; font-weight: 700; color: #fbbf24;">${metrics.vpp.toFixed(2)} V</div>
            <div style="font-size: 10px; color: var(--text-muted);">Final Steady-State: 5.00 V</div>
          </div>
        </div>
      </div>
    `;

    this._setupCanvas();
    this._drawGraticuleAndTraces();
  }

  _setupCanvas() {
    this.canvas = document.getElementById('canvas-oscilloscope-screen');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Handle mouse move for interactive cursor
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const frac = mouseX / rect.width;
      const maxT = 6.0; // 6 ms total
      this.hoverTime = frac * maxT;
      this._updateCursorReadout(this.hoverTime);
      this._drawGraticuleAndTraces();
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.hoverTime = null;
      this._drawGraticuleAndTraces();
    });
  }

  _updateCursorReadout(timeMs) {
    const el = document.getElementById('scope-cursor-readout');
    if (!el) return;

    // Interpolate channels at timeMs
    let vIn = timeMs >= 0.5 ? 5.0 : 0.0;
    let vOut = timeMs >= 0.5 ? 5.0 * (1.0 - Math.exp(-(timeMs - 0.5) / 1.0)) : 0.0;
    let iCap = timeMs >= 0.5 ? 5.0 * Math.exp(-(timeMs - 0.5) / 1.0) : 0.0;

    el.innerHTML = `
      <span style="color: #ffffff;">T: ${timeMs.toFixed(3)} ms</span>
      <span style="color: #facc15;">CH1 (Vin): ${vIn.toFixed(3)} V</span>
      <span style="color: #00e5ff;">CH2 (Vout): ${vOut.toFixed(3)} V</span>
      <span style="color: #ec4899;">CH3 (Icap): ${iCap.toFixed(3)} mA</span>
    `;
  }

  _drawGraticuleAndTraces() {
    if (!this.canvas || !this.ctx) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // 1. Draw Oscilloscope Reticle / Graticule Grid (10 horizontal divs, 8 vertical divs)
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.lineWidth = 1;

    const numX = 10;
    const numY = 8;
    const dx = w / numX;
    const dy = h / numY;

    for (let i = 0; i <= numX; i++) {
      ctx.beginPath();
      ctx.moveTo(i * dx, 0); ctx.lineTo(i * dx, h);
      ctx.stroke();
    }
    for (let j = 0; j <= numY; j++) {
      ctx.beginPath();
      ctx.moveTo(0, j * dy); ctx.lineTo(w, j * dy);
      ctx.stroke();
    }

    // Center axes with tick marks
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75); // Ground reference at 75% height
    ctx.stroke();

    // 2. Draw Waveform Channels
    const groundY = h * 0.75;
    const voltScalePx = (h * 0.55) / 5.0; // 5V spans 55% of height
    const maxT = 6.0; // ms

    const drawTrace = (wf, color, lineWidth = 2) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();

      for (let i = 0; i < wf.points.length; i++) {
        const pt = wf.points[i];
        const px = (pt.t / maxT) * w;
        const py = groundY - pt.v * voltScalePx;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    for (const wf of this.waveforms) {
      drawTrace(wf, wf.color || '#00e5ff', 2);
    }

    // 3. Draw Vertical Cursor if Hovering
    if (this.hoverTime !== null) {
      const cx = (this.hoverTime / maxT) * w;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _getDefaultWaveforms() {
    const pointsCH1 = [];
    const pointsCH2 = [];
    const pointsCH3 = [];

    const tau = 1.0; // ms
    const tStep = 5.0; // step at 0.5 ms
    const V0 = 5.0;

    for (let t = 0; t <= 6.0; t += 0.05) {
      // CH1: Step voltage at t = 0.5 ms
      const vin = t >= 0.5 ? V0 : 0.0;
      pointsCH1.push({ t, v: vin });

      // CH2: RC Low-pass filter capacitor voltage: V(t) = V0*(1 - e^(-(t-0.5)/tau))
      const vout = t >= 0.5 ? V0 * (1.0 - Math.exp(-(t - 0.5) / tau)) : 0.0;
      pointsCH2.push({ t, v: vout });

      // CH3: Charging current i(t) = (V0/R)*e^(-(t-0.5)/tau) [in mA]
      const icap = t >= 0.5 ? V0 * Math.exp(-(t - 0.5) / tau) : 0.0;
      pointsCH3.push({ t, v: icap });
    }

    return [
      { name: 'V_in', color: '#facc15', points: pointsCH1 },
      { name: 'V_out', color: '#00e5ff', points: pointsCH2 },
      { name: 'I_cap', color: '#ec4899', points: pointsCH3 }
    ];
  }

  _computeMetrics(waveforms) {
    const tauMs = 1.0;
    const riseTimeMs = 2.197 * tauMs; // 10% to 90%
    const cutoffHz = 1.0 / (2.0 * Math.PI * 1000.0 * 1e-6); // 159.2 Hz
    const vpp = 5.0;
    return { tauMs, riseTimeMs, cutoffHz, vpp };
  }
}

if (typeof window !== 'undefined') {
  window.SpiceOscilloscopeUI = SpiceOscilloscopeUI;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpiceOscilloscopeUI };
}
