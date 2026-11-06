/**
 * Read-only experimental optical glass lookup panel.
 *
 * Lists bundled datasheet-published glasses (Sellmeier B/C, nd, Vd) and draws
 * a computed n(lambda) SVG polyline. DOM-only: no innerHTML, no inline scripts,
 * no randomness. Data comes from the read-only IPC route
 * omni:optics-glass-lookup.
 */
'use strict';

(function attachOpticsGlassLookupView(global) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SPECTRUM_WIDTH = 340;
  const SPECTRUM_HEIGHT = 150;
  const SPECTRUM_MARGIN = 24;

  function filterGlasses(glasses, query) {
    const needle = String(query || '')
      .trim()
      .toLowerCase();
    const list = Array.isArray(glasses) ? glasses : [];
    if (!needle) return list.slice();
    return list.filter((glass) =>
      [glass.name, glass.supplier, glass.type].some((text) => String(text).toLowerCase().includes(needle))
    );
  }

  function validIndex(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  }

  function buildSpectrumModel(spectrum) {
    const list = Array.isArray(spectrum) ? spectrum : [];
    const points = [];
    for (const sample of list) {
      if (sample && validIndex(sample.wavelengthUm) && validIndex(sample.index)) {
        points.push({ wavelengthUm: sample.wavelengthUm, index: sample.index });
      }
    }
    if (points.length < 2) return { success: false, points: [] };
    let minIndex = Infinity;
    let maxIndex = -Infinity;
    let minWavelength = Infinity;
    let maxWavelength = -Infinity;
    for (const point of points) {
      minIndex = Math.min(minIndex, point.index);
      maxIndex = Math.max(maxIndex, point.index);
      minWavelength = Math.min(minWavelength, point.wavelengthUm);
      maxWavelength = Math.max(maxWavelength, point.wavelengthUm);
    }
    const pad = Math.max((maxIndex - minIndex) * 0.1, 1e-6);
    const indexMin = minIndex - pad;
    const indexMax = maxIndex + pad;
    const mapped = points.map((point) => ({
      wavelengthUm: point.wavelengthUm,
      index: point.index,
      x:
        SPECTRUM_MARGIN +
        ((point.wavelengthUm - minWavelength) / (maxWavelength - minWavelength || 1)) *
          (SPECTRUM_WIDTH - 2 * SPECTRUM_MARGIN),
      y:
        SPECTRUM_HEIGHT -
        SPECTRUM_MARGIN -
        ((point.index - indexMin) / (indexMax - indexMin || 1)) * (SPECTRUM_HEIGHT - 2 * SPECTRUM_MARGIN)
    }));
    return {
      success: true,
      points: mapped,
      minWavelength,
      maxWavelength,
      minIndex: indexMin,
      maxIndex: indexMax
    };
  }

  function renderSpectrumSvg(documentRef, svgContainer, spectrumModel) {
    if (!svgContainer || !documentRef?.createElementNS) return { success: false, error: 'SVG container unavailable.' };
    const svg = documentRef.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${SPECTRUM_WIDTH} ${SPECTRUM_HEIGHT}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.className = 'optics-spectrum-svg';

    if (!spectrumModel || spectrumModel.success !== true || spectrumModel.points.length < 2) {
      svg.setAttribute('data-empty', 'true');
      svgContainer.replaceChildren(svg);
      return { success: true, empty: true };
    }

    if (documentRef.createElementNS) {
      const polyline = documentRef.createElementNS(SVG_NS, 'polyline');
      polyline.setAttribute(
        'points',
        spectrumModel.points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
      );
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', 'var(--accent-cyan, #38bdf8)');
      polyline.setAttribute('stroke-width', '2');
      svg.appendChild(polyline);

      const minLabel = documentRef.createElementNS(SVG_NS, 'text');
      minLabel.setAttribute('x', String(SPECTRUM_MARGIN));
      minLabel.setAttribute('y', String(SPECTRUM_HEIGHT - 6));
      minLabel.textContent = `${spectrumModel.minWavelength.toFixed(2)} µm`;
      svg.appendChild(minLabel);

      const maxLabel = documentRef.createElementNS(SVG_NS, 'text');
      maxLabel.setAttribute('x', String(SPECTRUM_WIDTH - SPECTRUM_MARGIN - 44));
      maxLabel.setAttribute('y', String(SPECTRUM_HEIGHT - 6));
      maxLabel.textContent = `${spectrumModel.maxWavelength.toFixed(2)} µm`;
      svg.appendChild(maxLabel);

      const indexLabel = documentRef.createElementNS(SVG_NS, 'text');
      indexLabel.setAttribute('x', String(SPECTRUM_MARGIN));
      indexLabel.setAttribute('y', String(SPECTRUM_MARGIN - 4));
      indexLabel.textContent = `n ${spectrumModel.maxIndex.toFixed(4)} … ${spectrumModel.minIndex.toFixed(4)}`;
      svg.appendChild(indexLabel);
    }

    svgContainer.replaceChildren(svg);
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

  function renderGlassDetails(documentRef, container, glass) {
    if (!container || !glass) return { success: false, error: 'No glass record to render.' };
    container.replaceChildren();
    appendRow(documentRef, container, 'Glass', glass.name);
    appendRow(documentRef, container, 'Supplier / type', `${glass.supplier || 'unknown'} · ${glass.type || 'unknown'}`);
    appendRow(documentRef, container, 'nd', typeof glass.nd === 'number' ? glass.nd.toFixed(5) : 'Unavailable');
    appendRow(
      documentRef,
      container,
      'Abbe Vd',
      typeof glass.Abbe_Vd === 'number' ? glass.Abbe_Vd.toFixed(2) : 'Unavailable'
    );
    if (Array.isArray(glass.sellmeier?.B) && Array.isArray(glass.sellmeier?.C)) {
      appendRow(
        documentRef,
        container,
        'Sellmeier B',
        glass.sellmeier.B.map((value) => value.toExponential(3)).join(', ')
      );
      appendRow(
        documentRef,
        container,
        'Sellmeier C',
        glass.sellmeier.C.map((value) => value.toExponential(3)).join(', ')
      );
    }
    if (typeof glass.dndTPerK === 'number') {
      appendRow(documentRef, container, 'dndT/dT (K⁻¹)', glass.dndTPerK.toExponential(3));
    }
    appendRow(documentRef, container, 'Data status', glass.dataStatus || 'caller-supplied');
    if (glass.provenance) {
      const provenance = documentRef.createElement('div');
      provenance.className = 'material-card-source';
      provenance.textContent =
        (glass.provenance.manufacturer ? `${glass.provenance.manufacturer}: ` : '') +
        (glass.provenance.note || 'Manufacturer datasheet provenance.');
      container.appendChild(provenance);
    }
    return { success: true };
  }

  function mount(documentRef, root, api, options = {}) {
    if (!root || !documentRef?.createElement) return { success: false, error: 'Glass panel root unavailable.' };
    let glasses = [];
    const wavelengthsUm = options.wavelengthsUm || [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1.0, 1.5, 2.0];

    const panel = documentRef.createElement('div');
    panel.className = 'param-group optics-glass-panel';

    const title = documentRef.createElement('div');
    title.className = 'param-group-title';
    title.textContent = 'Optics Glass Lookup (experimental)';
    panel.appendChild(title);

    const select = documentRef.createElement('select');
    select.className = 'select-input optics-glass-select';
    panel.appendChild(select);

    const details = documentRef.createElement('div');
    details.className = 'optics-glass-details';
    panel.appendChild(details);

    const svgContainer = documentRef.createElement('div');
    svgContainer.className = 'optics-glass-spectrum';
    panel.appendChild(svgContainer);

    const note = documentRef.createElement('div');
    note.className = 'status-indicator status-warn';
    note.textContent =
      'Experimental: datasheet-published Sellmeier coefficients; computed n(λ) is not independently validated.';
    panel.appendChild(note);

    root.replaceChildren(panel);

    function populateSelect() {
      select.replaceChildren();
      for (const glass of glasses) {
        const option = documentRef.createElement('option');
        option.value = glass.name;
        option.textContent = `${glass.name} (${glass.supplier || '?'})`;
        select.appendChild(option);
      }
      if (glasses.length > 0) {
        select.value = glasses[0].name;
        renderSelected(glasses[0]);
      } else {
        renderGlassDetails(documentRef, details, null);
        renderSpectrumSvg(documentRef, svgContainer, null);
      }
    }

    function renderSelected(glass) {
      renderGlassDetails(documentRef, details, glass);
      const model = buildSpectrumModel(glass?.spectrum);
      renderSpectrumSvg(documentRef, svgContainer, model);
    }

    select.addEventListener('change', () => {
      const glass = glasses.find((entry) => entry.name === select.value);
      if (glass) renderSelected(glass);
    });

    function load() {
      if (!api || typeof api.opticsGlassLookup !== 'function') {
        renderGlassDetails(documentRef, details, null);
        renderSpectrumSvg(documentRef, svgContainer, null);
        note.textContent = 'Optics glass IPC route is unavailable in this build.';
        return;
      }
      const query = typeof options.query === 'string' ? options.query : '';
      api.opticsGlassLookup({ query, wavelengthsUm }).then(
        (response) => {
          glasses = response?.success === true && Array.isArray(response.glasses) ? response.glasses : [];
          populateSelect();
        },
        () => {
          note.textContent = 'Glass lookup failed; check the renderer console.';
        }
      );
    }

    load();
    return { success: true };
  }

  const api = Object.freeze({
    filterGlasses,
    buildSpectrumModel,
    renderSpectrumSvg,
    renderGlassDetails,
    mount
  });
  if (global) global.OmniOpticsGlassLookupView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
