/**
 * Read-only experimental materials catalog viewer.
 *
 * Renders documented-typical material cards (E / nu / rho / Sy at 293 K and
 * interpolated E) as DOM text nodes only. No innerHTML, no inline scripts, no
 * randomness. The catalog data comes from the read-only IPC route
 * omni:materials-catalog-query.
 */
'use strict';

(function attachMaterialsCatalogView(global) {
  function filterCards(cards, search) {
    const needle = String(search || '')
      .trim()
      .toLowerCase();
    const list = Array.isArray(cards) ? cards : [];
    if (!needle) return list.slice();
    return list.filter((card) =>
      [card.id, card.name, card.class].some((text) => String(text).toLowerCase().includes(needle))
    );
  }

  function formatGPa(pa) {
    if (typeof pa !== 'number' || !Number.isFinite(pa)) return 'Unavailable';
    return `${(pa / 1e9).toFixed(2)} GPa`;
  }

  function formatRho(rho) {
    if (typeof rho !== 'number' || !Number.isFinite(rho)) return 'Unavailable';
    return `${rho} kg/m³`;
  }

  function appendRow(documentRef, container, label, value) {
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
    container.appendChild(row);
  }

  function buildCard(documentRef, card, temperatureK) {
    const cardElement = documentRef.createElement('div');
    cardElement.className = 'telemetry-card material-card';

    const title = documentRef.createElement('div');
    title.className = 'material-card-title';
    title.textContent = `${card.id} — ${card.name}`;
    cardElement.appendChild(title);

    const classLine = documentRef.createElement('div');
    classLine.className = 'material-card-class';
    classLine.textContent = card.class || '';
    cardElement.appendChild(classLine);

    appendRow(documentRef, cardElement, 'Validation', card.validationStatus || 'documented-typical');
    if (card.source) {
      const sourceLine = documentRef.createElement('div');
      sourceLine.className = 'material-card-source';
      const reference = typeof card.source.reference === 'string' ? card.source.reference : '';
      sourceLine.textContent = reference || 'Source reference unavailable';
      cardElement.appendChild(sourceLine);
    }

    appendRow(documentRef, cardElement, 'E at 293 K', formatGPa(card.E293Pa));
    appendRow(
      documentRef,
      cardElement,
      'Poisson ratio ν',
      typeof card.nu === 'number' ? String(card.nu) : 'Unavailable'
    );
    appendRow(documentRef, cardElement, 'Density ρ', formatRho(card.rhoKgM3));
    appendRow(documentRef, cardElement, 'Yield strength Sy at 293 K', formatGPa(card.Sy293Pa));
    appendRow(documentRef, cardElement, `E at ${temperatureK} K`, formatGPa(card.EAtTemperatureKPa));
    return cardElement;
  }

  function renderCatalog(documentRef, container, cards, temperatureK, note) {
    if (!container || !documentRef?.createElement || typeof container.replaceChildren !== 'function') {
      return { success: false, error: 'The materials catalog container is unavailable.' };
    }
    const list = filterCards(cards, '');
    const count = documentRef.createElement('div');
    count.className = 'material-count';
    count.textContent = `${list.length} documented-typical material ${list.length === 1 ? 'card' : 'cards'} shown`;
    container.replaceChildren(count);

    for (const card of list) {
      container.appendChild(buildCard(documentRef, card, temperatureK));
    }

    const noteElement = documentRef.createElement('div');
    noteElement.className = 'status-indicator status-warn';
    noteElement.textContent =
      note || 'Experimental viewer: documented-typical values only; not certified design allowables.';
    container.appendChild(noteElement);
    return { success: true };
  }

  function createSearchInput(documentRef, onChange) {
    const input = documentRef.createElement('input');
    input.type = 'text';
    input.className = 'text-input materials-search-input';
    input.placeholder = 'Search materials by id, name, or class...';
    input.addEventListener('input', () => onChange(String(input.value || '')));
    return input;
  }

  function createTemperatureSlider(documentRef, onChange) {
    const slider = documentRef.createElement('input');
    slider.type = 'range';
    slider.className = 'slider-input materials-temperature-slider';
    slider.min = '200';
    slider.max = '1200';
    slider.step = '10';
    slider.value = '293';
    slider.addEventListener('input', () => onChange(Number(slider.value)));
    return slider;
  }

  function mount(documentRef, root, api, options = {}) {
    if (!root || !documentRef?.createElement) return { success: false, error: 'Materials panel root unavailable.' };
    const temperatureK = Number.isFinite(options.temperatureK) ? options.temperatureK : 293;
    let cards = [];
    let search = '';

    const panel = documentRef.createElement('div');
    panel.className = 'param-group materials-panel';

    const title = documentRef.createElement('div');
    title.className = 'param-group-title';
    title.textContent = 'Materials Catalog (experimental)';
    panel.appendChild(title);

    const controls = documentRef.createElement('div');
    controls.className = 'materials-controls';

    const tempLabel = documentRef.createElement('span');
    tempLabel.className = 'param-label-row';
    tempLabel.textContent = 'E temperature (K)';
    controls.appendChild(tempLabel);

    const slider = createTemperatureSlider(documentRef, (value) => {
      tempReadout.textContent = `${value} K`;
      refresh();
    });
    controls.appendChild(slider);

    const tempReadout = documentRef.createElement('span');
    tempReadout.className = 'param-val';
    tempReadout.textContent = `${temperatureK} K`;
    controls.appendChild(tempReadout);

    const searchInput = createSearchInput(documentRef, (value) => {
      search = value;
      refresh();
    });
    controls.appendChild(searchInput);

    panel.appendChild(controls);

    const results = documentRef.createElement('div');
    results.className = 'materials-results';
    panel.appendChild(results);

    root.replaceChildren(panel);

    function refresh() {
      const filtered = filterCards(cards, search);
      renderCatalog(documentRef, results, filtered, temperatureK, options.note);
    }

    function load() {
      if (!api || typeof api.materialsCatalogQuery !== 'function') {
        renderCatalog(documentRef, results, [], temperatureK, 'Materials IPC route is unavailable in this build.');
        return;
      }
      api.materialsCatalogQuery({ search, temperatureK }).then(
        (response) => {
          cards = response?.success === true && Array.isArray(response.cards) ? response.cards : [];
          refresh();
        },
        () => {
          renderCatalog(documentRef, results, [], temperatureK, 'Materials query failed; check the renderer console.');
        }
      );
    }

    load();
    return { success: true };
  }

  const api = Object.freeze({
    filterCards,
    formatGPa,
    renderCatalog,
    buildCard,
    mount
  });
  if (global) global.OmniMaterialsCatalogView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
