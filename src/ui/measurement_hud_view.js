/**
 * DOM-only renderer for point-to-point viewport measurement feedback.
 */
'use strict';

(function attachMeasurementHudView(global) {
  const TITLES = Object.freeze({
    active: '3D Caliper Measurement Active',
    anchored: 'Point 1 Anchored',
    result: '3D Caliper Result',
    unavailable: '3D Caliper Result'
  });

  function appendLine(documentRef, parent, className, text) {
    const line = documentRef.createElement('div');
    line.className = className;
    line.textContent = text;
    parent.appendChild(line);
    return line;
  }

  function finitePoint(point) {
    return Boolean(point) && [point.x, point.y, point.z].every(Number.isFinite);
  }

  function renderMeasurementHud(hud, documentRef, state = {}) {
    if (!hud || typeof hud.replaceChildren !== 'function' || typeof documentRef?.createElement !== 'function') {
      return { success: false, error: 'The measurement HUD is unavailable.' };
    }

    const phase = Object.prototype.hasOwnProperty.call(TITLES, state.phase) ? state.phase : 'unavailable';
    const title = documentRef.createElement('div');
    title.className = 'measurement-hud-title';
    title.style.fontWeight = '700';
    title.style.color = 'var(--accent-cyan)';
    title.style.marginBottom = '3px';
    title.style.display = 'flex';
    title.style.alignItems = 'center';
    title.style.gap = '6px';

    const icon = documentRef.createElement('span');
    icon.className = 'icon-slot';
    icon.setAttribute('data-omni-icon', 'caliper');
    title.appendChild(icon);

    const titleText = documentRef.createElement('span');
    titleText.textContent = TITLES[phase];
    title.appendChild(titleText);

    const content = documentRef.createElement('div');
    if (phase === 'active') {
      content.className = 'measurement-hud-message';
      content.style.color = 'var(--text-muted)';
      content.style.fontSize = '10px';
      content.textContent = 'Click first 3D vertex or component face to anchor...';
    } else if (phase === 'anchored') {
      content.className = 'measurement-hud-message';
      content.style.color = 'var(--text-muted)';
      content.style.fontSize = '10px';
      content.textContent = finitePoint(state.point)
        ? `P1(${state.point.x.toFixed(1)}, ${state.point.y.toFixed(1)}, ${state.point.z.toFixed(1)}) — Click second point...`
        : 'Measurement coordinates are unavailable.';
    } else if (phase === 'result') {
      const delta = state.delta;
      const validResult =
        Number.isFinite(state.distance) &&
        state.distance >= 0 &&
        finitePoint(delta) &&
        delta.x >= 0 &&
        delta.y >= 0 &&
        delta.z >= 0;
      if (validResult) {
        content.className = 'measurement-hud-result';
        content.style.fontSize = '13px';
        content.style.fontWeight = '700';
        content.style.color = '#fff';
        content.textContent = `Length: ${state.distance.toFixed(2)} mm`;

        const axes = documentRef.createElement('div');
        axes.className = 'measurement-hud-axes';
        axes.style.color = 'var(--text-dim)';
        axes.style.fontSize = '9px';
        axes.style.fontFamily = 'var(--font-mono)';
        axes.style.marginTop = '2px';
        axes.textContent = `ΔX: ${delta.x.toFixed(2)} mm | ΔY: ${delta.y.toFixed(2)} mm | ΔZ: ${delta.z.toFixed(2)} mm`;
        hud.replaceChildren(title, content, axes);
        return { success: true };
      }
      content.className = 'measurement-hud-message';
      content.style.color = 'var(--text-muted)';
      content.style.fontSize = '10px';
      content.textContent = 'Measurement values are unavailable.';
    } else {
      content.className = 'measurement-hud-message';
      content.style.color = 'var(--text-muted)';
      content.style.fontSize = '10px';
      content.textContent = 'Measurement values are unavailable.';
    }

    hud.replaceChildren(title, content);
    return { success: true };
  }

  const api = Object.freeze({ renderMeasurementHud });
  if (global) global.OmniMeasurementHudView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
