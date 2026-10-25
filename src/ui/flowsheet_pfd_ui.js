/**
 * Experimental plant flowsheet panel.
 * Renders caller-provided stream results without generating sample values.
 */

class FlowsheetPfdUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  render(result) {
    if (!this.container) return;

    const solution = result && result.solution && typeof result.solution === 'object' ? result.solution : {};
    const streams = Array.isArray(solution.streams)
      ? solution.streams
      : Array.isArray(result && result.streams)
        ? result.streams
        : null;
    const units = Array.isArray(solution.units)
      ? solution.units
      : Array.isArray(result && result.units)
        ? result.units
        : [];

    const panel = document.createElement('section');
    panel.className = 'experimental-unavailable-panel';
    panel.style.cssText =
      'padding:24px; border:1px solid var(--border-color); border-radius:8px; background:#0c1220; color:var(--text-main);';

    const title = document.createElement('h2');
    title.textContent = 'Experimental plant flowsheet';
    title.style.cssText = 'margin:0 0 8px; font-size:16px; color:var(--accent-cyan);';

    const message = document.createElement('p');
    message.textContent = streams
      ? 'Caller-provided flowsheet data is shown below. Solver validity and independent accuracy are not assessed.'
      : this._getUnavailableMessage(result);
    message.style.cssText = 'margin:0; max-width:720px; line-height:1.5; color:var(--text-muted);';

    const maturity = document.createElement('p');
    maturity.textContent = 'Maturity: experimental.';
    maturity.style.cssText = 'margin:12px 0 0; font-size:11px; color:var(--text-dim);';

    panel.append(title, message, maturity);
    if (streams) panel.append(this._renderStreamTable(streams));
    if (units.length > 0) panel.append(this._renderUnitList(units));
    this.container.replaceChildren(panel);
  }

  _getUnavailableMessage(result) {
    if (typeof (result && result.error) === 'string') return result.error;
    if (result && result.error && typeof result.error.message === 'string') return result.error.message;
    return 'Flowsheet results are unavailable. No validated user flowsheet schema or independent validation reference is configured.';
  }

  _renderStreamTable(streams) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'max-height:220px; overflow:auto; margin-top:14px;';
    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; font-size:11px; text-align:left;';
    const header = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const label of [
      'Stream ID',
      'Phase',
      'Temperature (°C)',
      'Pressure (kPa)',
      'Vapor fraction',
      'Molar flow (kmol/h)',
      'Composition'
    ]) {
      const cell = document.createElement('th');
      cell.textContent = label;
      cell.style.cssText = 'padding:6px 10px; color:var(--text-dim); border-bottom:1px solid var(--border-color);';
      headerRow.append(cell);
    }
    header.append(headerRow);
    const body = document.createElement('tbody');
    const validStreams = streams.filter((stream) => stream && typeof stream === 'object' && !Array.isArray(stream));
    if (validStreams.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = 'No stream records were supplied.';
      cell.style.cssText = 'padding:12px; text-align:center; color:var(--text-dim);';
      row.append(cell);
      body.append(row);
    }
    for (const stream of validStreams) {
      const row = document.createElement('tr');
      row.style.cssText = 'border-bottom:1px solid rgba(255,255,255,0.05); color:var(--text-main);';
      const vaporFraction = this._firstFinite(stream, ['vaporFraction']);
      const pressureKPa = this._firstFinite(stream, ['pressureKPa', 'P_kPa']);
      const pressureBar = this._firstFinite(stream, ['pressureBar']);
      const pressure = pressureKPa === null ? (pressureBar === null ? null : pressureBar * 100) : pressureKPa;
      const composition = this._formatComposition(stream.composition);
      const phase =
        vaporFraction === null
          ? 'Not supplied'
          : vaporFraction === 0
            ? 'Liquid'
            : vaporFraction === 1
              ? 'Vapor'
              : vaporFraction > 0 && vaporFraction < 1
                ? 'Two phase'
                : 'Outside [0, 1]';
      const values = [
        typeof stream.id === 'string' ? stream.id : '—',
        phase,
        this._formatNumber(this._firstFinite(stream, ['temperatureC', 'T_C']), 1),
        this._formatNumber(pressure, 2),
        this._formatNumber(vaporFraction, 3),
        this._formatNumber(this._firstFinite(stream, ['molarFlowKmolH', 'molarFlowKmolHr']), 2),
        composition
      ];
      for (const value of values) {
        const cell = document.createElement('td');
        cell.textContent = value;
        cell.style.cssText = 'padding:6px 10px;';
        row.append(cell);
      }
      body.append(row);
    }
    table.append(header, body);
    wrapper.append(table);
    return wrapper;
  }

  _renderUnitList(units) {
    const section = document.createElement('section');
    section.style.cssText = 'margin-top:14px;';
    const heading = document.createElement('h3');
    heading.textContent = 'Caller-provided unit operations';
    heading.style.cssText = 'font-size:12px; color:var(--accent-cyan);';
    const list = document.createElement('ul');
    for (const unit of units) {
      if (!unit || typeof unit !== 'object' || Array.isArray(unit)) continue;
      const item = document.createElement('li');
      const name =
        typeof unit.name === 'string' ? unit.name : typeof unit.id === 'string' ? unit.id : 'Unnamed operation';
      const type = typeof unit.type === 'string' ? ` (${unit.type})` : '';
      item.textContent = `${name}${type}`;
      list.append(item);
    }
    section.append(heading, list);
    return section;
  }

  _firstFinite(record, keys) {
    for (const key of keys) {
      if (Number.isFinite(record[key])) return record[key];
    }
    return null;
  }

  _formatNumber(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : '—';
  }

  _formatComposition(composition) {
    if (!composition || typeof composition !== 'object' || Array.isArray(composition)) return '—';
    const entries = Object.entries(composition).filter(([, fraction]) => Number.isFinite(fraction));
    return entries.length > 0 ? entries.map(([name, fraction]) => `${name}: ${fraction.toFixed(3)}`).join(' / ') : '—';
  }
}

if (typeof window !== 'undefined') {
  window.FlowsheetPfdUI = FlowsheetPfdUI;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FlowsheetPfdUI };
}
