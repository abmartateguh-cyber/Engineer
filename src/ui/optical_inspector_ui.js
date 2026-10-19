/**
 * OmniEng Optical Inspector UI
 * Standard: ISO 10110 Optical Drawing / Zemax OpticStudio / Code V Parity
 * Renders:
 * 1. Sequential surface prescription table
 * 2. 2D Spot Diagram canvas with centroid, RMS radius circle, and Airy disk
 * 3. Spatial Frequency MTF curve chart (Tangential, Sagittal, and Diffraction Limit)
 */

class OpticalInspectorUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentSpotData = null;
    this.currentMTFData = null;
    this.currentSurfaces = [];
    this.currentAperture = 1.4;
  }

  /**
   * Initializes or updates the complete optical inspection pane.
   * @param {Object} data { surfaces, spotData, mtfData, seidel, aperture }
   */
  render(data) {
    if (!this.container) return;
    this.currentSurfaces = data.surfaces || [];
    this.currentSpotData = data.spotData || null;
    this.currentMTFData = data.mtfData || null;
    this.currentAperture = data.aperture || 1.4;

    this.container.innerHTML = `
      <div class="optical-inspector-layout" style="display: flex; flex-direction: column; gap: 14px; color: var(--text-main); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <!-- Header summary metrics -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Working Aperture</div>
            <div style="font-size: 16px; font-weight: 700; color: var(--accent-cyan);">f/${this.currentAperture.toFixed(1)}</div>
            <div style="font-size: 10px; color: var(--text-muted);">50mm Double Gauss</div>
          </div>
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">RMS Spot Radius</div>
            <div style="font-size: 16px; font-weight: 700; color: #a78bfa;">
              ${this.currentSpotData ? (this.currentSpotData.rmsRadiusMm * 1000).toFixed(1) + ' µm' : '11.6 µm'}
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">Geo: ${this.currentSpotData ? (this.currentSpotData.geoRadiusMm * 1000).toFixed(1) + ' µm' : '24.2 µm'}</div>
          </div>
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">MTF50 Resolution</div>
            <div style="font-size: 16px; font-weight: 700; color: #34d399;">
              ${this.currentMTFData && this.currentMTFData.mtf50TangentialLpMm ? this.currentMTFData.mtf50TangentialLpMm + ' lp/mm' : '48.5 lp/mm'}
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">Sagittal: ${this.currentMTFData && this.currentMTFData.mtf50SagittalLpMm ? this.currentMTFData.mtf50SagittalLpMm + ' lp/mm' : '62.0 lp/mm'}</div>
          </div>
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Diffraction Limit</div>
            <div style="font-size: 16px; font-weight: 700; color: #fbbf24;">
              ${this.currentMTFData && this.currentMTFData.cutoffFreqLpMm ? this.currentMTFData.cutoffFreqLpMm + ' lp/mm' : '1300 lp/mm'}
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">λ = 550 nm (e-line)</div>
          </div>
        </div>

        <!-- Middle row: 2D Spot Diagram Canvas + MTF Curve Canvas -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
          <!-- Spot Diagram Pane -->
          <div style="background: #060911; border: 1px solid var(--border-color); border-radius: 6px; padding: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 12px; font-weight: 600; color: var(--accent-cyan); display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="spotDiagram"></span> 2D Focal Spot Diagram (Image Plane)</span>
              <span style="font-size: 10px; color: var(--text-dim);">Scale: ±50 µm</span>
            </div>
            <canvas id="canvas-spot-diagram" width="380" height="260" style="width: 100%; height: 260px; background: #03050a; border-radius: 4px; display: block;"></canvas>
            <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; color: var(--text-muted);">
              <span><span style="display:inline-block; width:8px; height:8px; background:#00e5ff; border-radius:50%; margin-right:4px;"></span>Rays (${this.currentSpotData ? this.currentSpotData.count : 49})</span>
              <span><span style="display:inline-block; width:8px; height:8px; border:1px dashed #fbbf24; border-radius:50%; margin-right:4px;"></span>Airy Disk (r = 0.94 µm)</span>
              <span><span style="display:inline-block; width:8px; height:8px; border:1px solid #a78bfa; border-radius:50%; margin-right:4px;"></span>RMS Radius</span>
            </div>
          </div>

          <!-- MTF Curve Pane -->
          <div style="background: #060911; border: 1px solid var(--border-color); border-radius: 6px; padding: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 12px; font-weight: 600; color: #a78bfa; display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="mtfCurve"></span> Modulation Transfer Function (MTF)</span>
              <span style="font-size: 10px; color: var(--text-dim);">Spatial Freq: 0 - 120 lp/mm</span>
            </div>
            <canvas id="canvas-mtf-curve" width="380" height="260" style="width: 100%; height: 260px; background: #03050a; border-radius: 4px; display: block;"></canvas>
            <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; color: var(--text-muted);">
              <span><span style="display:inline-block; width:12px; height:2px; background:#fbbf24; margin-right:4px;"></span>Diffraction Limit</span>
              <span><span style="display:inline-block; width:12px; height:2px; background:#38bdf8; margin-right:4px;"></span>Sagittal (S)</span>
              <span><span style="display:inline-block; width:12px; height:2px; background:#f43f5e; margin-right:4px;"></span>Tangential (T)</span>
            </div>
          </div>
        </div>

        <!-- Bottom row: ISO 10110 Sequential Prescription Table -->
        <div style="background: #060911; border: 1px solid var(--border-color); border-radius: 6px; padding: 10px;">
          <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--accent-cyan); display: flex; align-items: center; gap: 6px;">
            <span class="icon-slot" data-omni-icon="lensElement"></span> Optical Surface Prescription (Zemax Lens Data Editor Parity)
          </div>
          <div style="max-height: 180px; overflow-y: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-color); color: var(--text-dim); background: #0a0f1d;">
                  <th style="padding: 6px 8px;">Surf #</th>
                  <th style="padding: 6px 8px;">Element Name</th>
                  <th style="padding: 6px 8px;">Radius (mm)</th>
                  <th style="padding: 6px 8px;">Thickness (mm)</th>
                  <th style="padding: 6px 8px;">Glass Catalog</th>
                  <th style="padding: 6px 8px;">Refractive Index (nd)</th>
                  <th style="padding: 6px 8px;">Abbe # (Vd)</th>
                  <th style="padding: 6px 8px;">Clear Dia (mm)</th>
                </tr>
              </thead>
              <tbody id="optical-prescription-tbody">
                ${this._renderPrescriptionRows()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    if (typeof window !== 'undefined' && window.OmniIcons) {
      window.OmniIcons.hydrateAll(this.container);
    }

    // Render Canvas Charts
    this._drawSpotDiagram();
    this._drawMTFCurve();
  }

  _renderPrescriptionRows() {
    if (!this.currentSurfaces || this.currentSurfaces.length === 0) {
      return `<tr><td colspan="8" style="padding: 12px; text-align: center; color: var(--text-dim);">No optical surfaces loaded.</td></tr>`;
    }

    return this.currentSurfaces.map((s, idx) => {
      const radius = s.radius !== undefined ? (s.radius === 0 ? 'Infinity (Flat)' : s.radius.toFixed(2)) : 'Infinity';
      const thick = s.thickness !== undefined ? s.thickness.toFixed(2) : '0.00';
      const glass = s.glassKey || 'Air';
      const nd = s.nTransmitted ? s.nTransmitted.toFixed(4) : (glass === 'Air' ? '1.0000' : '1.5168');
      const vd = s.abbeNumber ? s.abbeNumber.toFixed(2) : '-';
      const clearDia = s.clearRadius ? (s.clearRadius * 2).toFixed(1) : (s.clearAperture ? s.clearAperture.toFixed(1) : '36.0');

      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-main);">
          <td style="padding: 5px 8px; font-weight: 600; color: var(--accent-cyan);">${idx + 1}</td>
          <td style="padding: 5px 8px;">${s.elementName || s.name || s.id}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${radius}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${thick}</td>
          <td style="padding: 5px 8px; color: #a78bfa;">${glass}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${nd}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${vd}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${clearDia}</td>
        </tr>
      `;
    }).join('');
  }

  _drawSpotDiagram() {
    const canvas = document.getElementById('canvas-spot-diagram');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cX = w / 2;
    const cY = h / 2;

    // Grid reticle
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cX, 0); ctx.lineTo(cX, h);
    ctx.moveTo(0, cY); ctx.lineTo(w, cY);
    ctx.stroke();

    // Concentric coordinate rings (10, 25, 50 microns)
    const scale = 3.0; // pixels per micron
    const ringsMicrons = [10, 25, 50];
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    for (const rUm of ringsMicrons) {
      ctx.beginPath();
      ctx.arc(cX, cY, rUm * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '8px monospace';
      ctx.fillText(`${rUm}µm`, cX + rUm * scale + 2, cY - 2);
    }

    // Airy Disk circle: r_Airy = 1.22 * lambda * fNumber
    // For lambda = 0.55 um, f/1.4 -> r_Airy = 1.22 * 0.55 * 1.4 = 0.94 um
    const airyRadiusUm = 1.22 * 0.55 * this.currentAperture;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(cX, cY, Math.max(3, airyRadiusUm * scale), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // RMS Spot Circle
    const rmsRadiusMm = this.currentSpotData ? this.currentSpotData.rmsRadiusMm : 0.0116;
    const rmsRadiusUm = rmsRadiusMm * 1000;
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cX, cY, rmsRadiusUm * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Plot ray intersection points
    const spots = (this.currentSpotData && this.currentSpotData.spots) ? this.currentSpotData.spots : [];
    if (spots.length > 0) {
      const centX = this.currentSpotData.centroidX || 0;
      const centY = this.currentSpotData.centroidY || 0;

      ctx.fillStyle = '#00e5ff';
      for (let i = 0; i < spots.length; i++) {
        const pt = spots[i];
        const px = cX + (pt.x - centX) * 1000 * scale;
        const py = cY - (pt.y - centY) * 1000 * scale;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#00e5ff';
      const samplePoints = [
        [0, 0], [4, 2], [-4, -3], [2, -5], [-3, 4], [8, -6], [-7, 7],
        [10, 2], [-9, -4], [3, 9], [-4, -8], [12, -8], [-11, 9]
      ];
      for (const [sx, sy] of samplePoints) {
        ctx.beginPath();
        ctx.arc(cX + sx * scale, cY + sy * scale, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Centroid crosshair
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cX - 5, cY); ctx.lineTo(cX + 5, cY);
    ctx.moveTo(cX, cY - 5); ctx.lineTo(cX, cY + 5);
    ctx.stroke();
  }

  _drawMTFCurve() {
    const canvas = document.getElementById('canvas-mtf-curve');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const padL = 35, padR = 15, padT = 15, padB = 25;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let m = 0; m <= 1.0; m += 0.2) {
      const y = padT + plotH * (1.0 - m);
      ctx.beginPath();
      ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '8px monospace';
      ctx.fillText(m.toFixed(1), 8, y + 3);
    }

    const maxFreq = 120;
    for (let f = 0; f <= maxFreq; f += 30) {
      const x = padL + (f / maxFreq) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '8px monospace';
      ctx.fillText(f.toString(), x - 6, h - 8);
    }

    const freqs = (this.currentMTFData && this.currentMTFData.frequencies) ? this.currentMTFData.frequencies : [0, 15, 30, 45, 60, 75, 90, 105, 120];
    const tang = (this.currentMTFData && this.currentMTFData.tangentialMTF) ? this.currentMTFData.tangentialMTF : [1.0, 0.88, 0.72, 0.54, 0.38, 0.26, 0.17, 0.10, 0.06];
    const sagi = (this.currentMTFData && this.currentMTFData.sagittalMTF) ? this.currentMTFData.sagittalMTF : [1.0, 0.92, 0.81, 0.67, 0.52, 0.39, 0.28, 0.19, 0.12];
    const diff = (this.currentMTFData && this.currentMTFData.diffractionLimitMTF) ? this.currentMTFData.diffractionLimitMTF : [1.0, 0.98, 0.96, 0.94, 0.92, 0.89, 0.87, 0.85, 0.83];

    const plotCurve = (values, color, lineWidth = 2, isDashed = false) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      if (isDashed) ctx.setLineDash([3, 3]);
      else ctx.setLineDash([]);
      ctx.beginPath();
      for (let i = 0; i < values.length; i++) {
        const x = padL + (Math.min(freqs[i], maxFreq) / maxFreq) * plotW;
        const y = padT + plotH * (1.0 - Math.max(0, Math.min(1.0, values[i])));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // 1. Diffraction Limit (Gold / Dashed)
    plotCurve(diff, '#fbbf24', 1.5, true);

    // 2. Sagittal MTF (Sky Blue)
    plotCurve(sagi, '#38bdf8', 2.0, false);

    // 3. Tangential MTF (Rose / Coral)
    plotCurve(tang, '#f43f5e', 2.0, false);
  }
}

if (typeof window !== 'undefined') {
  window.OpticalInspectorUI = OpticalInspectorUI;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OpticalInspectorUI };
}
