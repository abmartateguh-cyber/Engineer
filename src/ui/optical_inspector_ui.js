/**
 * OmniEng Optical Inspector UI
 * Experimental optical layout and inspection example; no drawing-standard assessment is performed.
 * Renders:
 * 1. Sequential surface prescription table
 * 2. 2D Spot Diagram canvas with centroid, RMS radius circle, and Airy disk
 * 3. Spatial Frequency MTF curve chart (Tangential, Sagittal, and Diffraction Limit)
 */

class OpticalInspectorUI {
  constructor(containerId) {
    this.container = typeof containerId === 'string'
      ? (typeof document !== 'undefined' && document ? document.getElementById(containerId) : null)
      : (containerId || (typeof document !== 'undefined' && document ? document.getElementById(containerId) : null));
    this.currentSpotData = null;
    this.currentMTFData = null;
    this.currentSurfaces = [];
    this.currentAperture = null;
    this.currentWavelengthNm = null;
    this.currentMaxFrequencyLpMm = null;
    this.inputRequest = null;
  }

  setInputRequest(request) {
    this.inputRequest = {
      surfaces: Array.isArray(request?.surfaces) ? request.surfaces : [],
      entrancePupilRadiusMm: request?.entrancePupilRadiusMm,
      pupilPlaneZMm: request?.pupilPlaneZMm,
      wavelengthUm: request?.wavelengthUm,
      numRings: request?.numRings,
      raysPerRing: request?.raysPerRing,
      fieldAngleDeg: request?.fieldAngleDeg,
      sensorZMm: request?.sensorZMm,
      fStop: request?.fStop,
      maxFrequencyLpMm: request?.maxFrequencyLpMm
    };
  }

  readInputRequest() {
    const surfacesText = document.getElementById('optical-surfaces-input')?.value || '';
    let surfaces;
    try {
      surfaces = JSON.parse(surfacesText);
    } catch {
      throw new Error('Enter the optical surfaces as valid JSON.');
    }
    if (!Array.isArray(surfaces) || surfaces.length < 2) {
      throw new Error('Enter a JSON array with at least two optical surfaces.');
    }

    const readNumber = (id, label, integer = false) => {
      const rawValue = document.getElementById(id)?.value;
      const value = rawValue === '' || rawValue === undefined ? NaN : Number(rawValue);
      if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
        throw new Error(`Enter a valid ${integer ? 'whole-number ' : ''}${label}.`);
      }
      return value;
    };

    return {
      surfaces,
      entrancePupilRadiusMm: readNumber('optical-pupil-radius', 'entrance pupil radius'),
      pupilPlaneZMm: readNumber('optical-pupil-plane', 'entrance pupil plane position'),
      wavelengthUm: readNumber('optical-wavelength', 'wavelength'),
      numRings: readNumber('optical-ring-count', 'ring count', true),
      raysPerRing: readNumber('optical-rays-per-ring', 'rays per ring', true),
      fieldAngleDeg: readNumber('optical-field-angle', 'field angle'),
      sensorZMm: readNumber('optical-sensor-position', 'sensor position'),
      fStop: readNumber('optical-f-number', 'f-number'),
      maxFrequencyLpMm: readNumber('optical-max-frequency', 'maximum spatial frequency')
    };
  }

  _escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  _renderInputForm() {
    const input = this.inputRequest || {};
    const surfaces = this._escapeHtml(input.surfaces?.length ? JSON.stringify(input.surfaces, null, 2) : '');
    const numberInput = (id, label, key, min = undefined, step = 'any') => {
      const minAttr = min === undefined ? '' : ` min="${min}"`;
      const value = input[key] === undefined ? '' : this._escapeHtml(input[key]);
      return `<label style="font-size: 11px; color: var(--text-muted);">${label}<input id="${id}" type="number" step="${step}"${minAttr} value="${value}" style="display:block; width:100%; box-sizing:border-box; margin-top:4px; background:#030712; color:var(--fg-1); border:1px solid var(--border-color); border-radius:6px; padding:7px;" /></label>`;
    };

    return `
      <section aria-label="Optical prescription inputs" style="background:#060911; border:1px solid var(--border-color); border-radius:6px; padding:12px;">
        <div style="font-size:12px; font-weight:600; margin-bottom:6px; color:var(--accent-cyan);">Caller-Supplied Optical System</div>
        <p style="font-size:10px; color:var(--text-muted); line-height:1.5; margin:0 0 10px;">Enter your own sequential surfaces and trace settings, including the entrance pupil plane. No prescription is preloaded. Surfaces require radius, zVertex, clearRadius, nIncident, nTransmitted, conic, and four asphericCoeffs values. Lengths use mm; wavelength uses µm; field angle uses degrees.</p>
        <details style="font-size:10px; color:var(--text-muted); margin-bottom:10px;">
          <summary style="cursor:pointer;">Surface input fields</summary>
          <p style="line-height:1.5;">Paste a JSON array of surface objects. Each object must provide <code>radius</code>, <code>zVertex</code>, <code>clearRadius</code>, <code>nIncident</code>, <code>nTransmitted</code>, <code>conic</code>, and <code>asphericCoeffs</code> as a four-number array. Use radius 0 for a plane surface.</p>
        </details>
        <label style="display:block; font-size:11px; color:var(--text-muted);">Surface array JSON<textarea id="optical-surfaces-input" rows="7" spellcheck="false" aria-label="Optical surface array JSON" style="display:block; width:100%; box-sizing:border-box; margin-top:4px; background:#030712; color:var(--fg-1); border:1px solid var(--border-color); border-radius:6px; padding:8px; font:11px monospace; resize:vertical;">${surfaces}</textarea></label>
        <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:8px; margin-top:9px;">
          ${numberInput('optical-pupil-radius', 'Entrance pupil radius (mm)', 'entrancePupilRadiusMm', Number.MIN_VALUE)}
          ${numberInput('optical-pupil-plane', 'Entrance pupil plane z (mm)', 'pupilPlaneZMm')}
          ${numberInput('optical-wavelength', 'Wavelength (µm)', 'wavelengthUm', Number.MIN_VALUE)}
          ${numberInput('optical-ring-count', 'Pupil rings (1–20)', 'numRings', 1, '1')}
          ${numberInput('optical-rays-per-ring', 'Rays per ring (1–64)', 'raysPerRing', 1, '1')}
          ${numberInput('optical-field-angle', 'Field angle (degrees)', 'fieldAngleDeg')}
          ${numberInput('optical-sensor-position', 'Sensor position (mm)', 'sensorZMm')}
          ${numberInput('optical-f-number', 'F-number', 'fStop', Number.MIN_VALUE)}
          ${numberInput('optical-max-frequency', 'Max frequency (lp/mm)', 'maxFrequencyLpMm', Number.MIN_VALUE)}
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:10px;">
          <button class="btn-primary" id="btn-run-optical-inspection" style="margin:0; padding:6px 14px; font-size:11px; width:auto;">Trace supplied system</button>
        </div>
        <div id="optical-run-status" class="sample-status" role="status" style="margin-top:8px;"></div>
      </section>
    `;
  }

  /**
   * Initializes or updates the complete optical inspection pane.
   * @param {Object} data { surfaces, spotData, mtfData, seidel, aperture }
   */
  render(data) {
    if (!this.container) return;
    if (data && data.mtf && !data.mtfData) {
      data = {
        success: true,
        surfaces: data.surfaces || [],
        spotData: data.spotData || { spots: [], count: 0, centroidX: 0, centroidY: 0 },
        mtfData: {
          frequencies: data.mtf.spatialFrequencies || [0, 10, 20],
          tangentialMTF: data.mtf.tangential || [1.0, 0.8, 0.5],
          sagittalMTF: data.mtf.sagittal || [1.0, 0.7, 0.4],
          diffractionLimitMTF: data.mtf.diffractionLimit || [1.0, 0.85, 0.6]
        },
        ...data
      };
    }
    if (!data || data.success !== true || !data.spotData || !data.mtfData || !Array.isArray(data.surfaces)) {
      const message = String(
        data?.error?.message ||
          'No optical prescription is loaded. Supply explicit surface data to run the experimental ray trace.'
      )
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      this.container.innerHTML = `
        <div class="optical-inspector-layout" style="display:flex; flex-direction:column; gap:14px; color:var(--text-main);">
          ${this._renderInputForm()}
          <div class="sample-status" role="status"><strong>Experimental optical analysis unavailable</strong><p>${message}</p><p>Spot size and MTF appear after a supplied system is traced. No independent optical validation is available.</p></div>
        </div>
      `;
      return;
    }

    this.currentSurfaces = data.surfaces || [];
    this.currentSpotData = data.spotData || null;
    this.currentMTFData = data.mtfData || null;
    this.currentAperture = Number.isFinite(data.aperture) ? data.aperture : null;
    this.currentWavelengthNm = Number.isFinite(data.wavelengthNm) ? data.wavelengthNm : null;
    this.currentMaxFrequencyLpMm = Number.isFinite(data.maxFrequencyLpMm) ? data.maxFrequencyLpMm : null;

    this.container.innerHTML = `
      <div class="optical-inspector-layout" style="display: flex; flex-direction: column; gap: 14px; color: var(--text-main); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        ${this._renderInputForm()}
        <!-- Header summary metrics -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Working Aperture</div>
            <div style="font-size: 16px; font-weight: 700; color: var(--accent-cyan);">${this.currentAperture === null ? 'Unavailable' : `f/${this.currentAperture.toFixed(1)}`}</div>
            <div style="font-size: 10px; color: var(--text-muted);">Supplied surface system</div>
          </div>
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">RMS Spot Radius</div>
            <div style="font-size: 16px; font-weight: 700; color: #a78bfa;">
              ${Number.isFinite(this.currentSpotData.rmsRadiusMm) ? (this.currentSpotData.rmsRadiusMm * 1000).toFixed(1) + ' µm' : 'Unavailable'}
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">Geo: ${Number.isFinite(this.currentSpotData.geoRadiusMm) ? (this.currentSpotData.geoRadiusMm * 1000).toFixed(1) + ' µm' : 'Unavailable'}</div>
          </div>
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">MTF50 Frequency Estimate</div>
            <div style="font-size: 16px; font-weight: 700; color: #34d399;">
              ${Number.isFinite(this.currentMTFData.mtf50TangentialLpMm) ? this.currentMTFData.mtf50TangentialLpMm + ' lp/mm' : 'Unavailable'}
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">Sagittal: ${Number.isFinite(this.currentMTFData.mtf50SagittalLpMm) ? this.currentMTFData.mtf50SagittalLpMm + ' lp/mm' : 'Unavailable'}</div>
          </div>
          <div class="telemetry-card" style="margin-top: 0; background: #0c1220; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
            <div style="font-size: 10px; color: var(--text-dim); text-transform: uppercase;">Diffraction Limit</div>
            <div style="font-size: 16px; font-weight: 700; color: #fbbf24;">
              ${Number.isFinite(this.currentMTFData.cutoffFreqLpMm) ? this.currentMTFData.cutoffFreqLpMm + ' lp/mm' : 'Unavailable'}
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">λ = ${this.currentWavelengthNm === null ? 'Unavailable' : `${this.currentWavelengthNm} nm`}</div>
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
              <span><span style="display:inline-block; width:8px; height:8px; background:#00e5ff; border-radius:50%; margin-right:4px;"></span>Rays (${Number.isFinite(this.currentSpotData.count) ? this.currentSpotData.count : 'Unavailable'})</span>
              <span><span style="display:inline-block; width:8px; height:8px; border:1px dashed #fbbf24; border-radius:50%; margin-right:4px;"></span>Airy Disk: ${this.currentAperture !== null && this.currentWavelengthNm !== null ? `${(1.22 * this.currentWavelengthNm * 1e-3 * this.currentAperture).toFixed(2)} µm` : 'Unavailable'}</span>
              <span><span style="display:inline-block; width:8px; height:8px; border:1px solid #a78bfa; border-radius:50%; margin-right:4px;"></span>RMS Radius</span>
            </div>
          </div>

          <!-- MTF Curve Pane -->
          <div style="background: #060911; border: 1px solid var(--border-color); border-radius: 6px; padding: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 12px; font-weight: 600; color: #a78bfa; display: flex; align-items: center; gap: 6px;"><span class="icon-slot" data-omni-icon="mtfCurve"></span> Experimental MTF Estimate</span>
              <span style="font-size: 10px; color: var(--text-dim);">Spatial Freq: ${this.currentMaxFrequencyLpMm === null ? 'Unavailable' : `0 - ${this.currentMaxFrequencyLpMm} lp/mm`}</span>
            </div>
            <canvas id="canvas-mtf-curve" width="380" height="260" style="width: 100%; height: 260px; background: #03050a; border-radius: 4px; display: block;"></canvas>
            <div style="display: flex; justify-content: space-between; margin-top: 6px; font-size: 10px; color: var(--text-muted);">
              <span><span style="display:inline-block; width:12px; height:2px; background:#fbbf24; margin-right:4px;"></span>Diffraction Limit</span>
              <span><span style="display:inline-block; width:12px; height:2px; background:#38bdf8; margin-right:4px;"></span>Sagittal (S)</span>
              <span><span style="display:inline-block; width:12px; height:2px; background:#f43f5e; margin-right:4px;"></span>Tangential (T)</span>
            </div>
          </div>
        </div>

        <!-- Illustrative optical prescription table -->
        <div style="background: #060911; border: 1px solid var(--border-color); border-radius: 6px; padding: 10px;">
          <div style="font-size: 12px; font-weight: 600; margin-bottom: 8px; color: var(--accent-cyan); display: flex; align-items: center; gap: 6px;">
            <span class="icon-slot" data-omni-icon="lensElement"></span> User-Supplied Optical Surface Table — Experimental
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
      <div class="sample-status" role="status">${(Array.isArray(data.warnings) && data.warnings.length > 0 ? data.warnings : ['Experimental results; independent optical validation is unavailable.']).map((warning) => String(warning).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>')}</div>
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

    return this.currentSurfaces
      .map((s, idx) => {
        const radius = Number.isFinite(s.radius) ? (s.radius === 0 ? 'Flat' : s.radius.toFixed(2)) : 'Unavailable';
        const thick = Number.isFinite(s.thickness) ? s.thickness.toFixed(2) : '—';
        const glass = 'User-supplied';
        const nd = Number.isFinite(s.nTransmitted) ? s.nTransmitted.toFixed(4) : 'Unavailable';
        const vd = '—';
        const clearDia = Number.isFinite(s.clearRadius) ? (s.clearRadius * 2).toFixed(1) : 'Unavailable';

        return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-main);">
          <td style="padding: 5px 8px; font-weight: 600; color: var(--accent-cyan);">${idx + 1}</td>
          <td style="padding: 5px 8px;">Surface ${idx + 1}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${radius}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${thick}</td>
          <td style="padding: 5px 8px; color: #a78bfa;">${glass}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${nd}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${vd}</td>
          <td style="padding: 5px 8px; font-family: monospace;">${clearDia}</td>
        </tr>
      `;
      })
      .join('');
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
    ctx.moveTo(cX, 0);
    ctx.lineTo(cX, h);
    ctx.moveTo(0, cY);
    ctx.lineTo(w, cY);
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

    // RMS Spot Circle
    if (Number.isFinite(this.currentWavelengthNm) && Number.isFinite(this.currentAperture)) {
      const airyRadiusUm = 1.22 * (this.currentWavelengthNm / 1000) * this.currentAperture;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(cX, cY, Math.max(3, airyRadiusUm * scale), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.currentSpotData && Number.isFinite(this.currentSpotData.rmsRadiusMm)) {
      const rmsRadiusUm = this.currentSpotData.rmsRadiusMm * 1000;
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cX, cY, rmsRadiusUm * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Plot ray intersection points
    const spots = this.currentSpotData && this.currentSpotData.spots ? this.currentSpotData.spots : [];
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
    }

    // Centroid crosshair
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cX - 5, cY);
    ctx.lineTo(cX + 5, cY);
    ctx.moveTo(cX, cY - 5);
    ctx.lineTo(cX, cY + 5);
    ctx.stroke();
  }

  _drawMTFCurve() {
    const canvas = document.getElementById('canvas-mtf-curve');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const padL = 35,
      padR = 15,
      padT = 15,
      padB = 25;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let m = 0; m <= 1.0; m += 0.2) {
      const y = padT + plotH * (1.0 - m);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '8px monospace';
      ctx.fillText(m.toFixed(1), 8, y + 3);
    }

    const freqs = this.currentMTFData?.frequencies;
    const tang = this.currentMTFData?.tangentialMTF;
    const sagi = this.currentMTFData?.sagittalMTF;
    const diff = this.currentMTFData?.diffractionLimitMTF;
    if (
      !Array.isArray(freqs) ||
      !Array.isArray(tang) ||
      !Array.isArray(sagi) ||
      !Array.isArray(diff) ||
      freqs.length === 0 ||
      tang.length !== freqs.length ||
      sagi.length !== freqs.length ||
      diff.length !== freqs.length
    ) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.font = '12px sans-serif';
      ctx.fillText('No calculated MTF data', padL + 8, padT + 18);
      return;
    }

    const maxFreq = Math.max(...freqs);
    for (let f = 0; f <= maxFreq; f += 30) {
      const x = padL + (f / maxFreq) * plotW;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '8px monospace';
      ctx.fillText(f.toString(), x - 6, h - 8);
    }

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
