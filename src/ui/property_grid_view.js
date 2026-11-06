'use strict';

(function attachPropertyGridView(global) {
  function createPropertyGridElements(doc, props, is3D = true) {
    if (!doc || typeof doc.createElement !== 'function' || !props || typeof props !== 'object') return [];

    const create = (tagName, className, text) => {
      const element = doc.createElement(tagName);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = String(text);
      return element;
    };

    const setAttributes = (element, attributes) => {
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
      return element;
    };

    const displayNumber = (value) => (Number.isFinite(value) ? String(value) : '');
    const posX = displayNumber(is3D ? props.position?.x : props.x);
    const posY = displayNumber(is3D ? props.position?.y : props.y);
    const posZ = displayNumber(props.position?.z);
    const width = displayNumber(props.w);
    const height = displayNumber(props.h);
    const hasDimensions =
      props.dimensions &&
      [props.dimensions.width, props.dimensions.height, props.dimensions.depth].every(Number.isFinite);
    const dimensions = hasDimensions
      ? `${props.dimensions.width} x ${props.dimensions.height} x ${props.dimensions.depth}`
      : 'Unavailable';

    const makeInput = (type, id, value, extra = {}) => {
      const input = create('input');
      input.type = type;
      input.id = id;
      input.value = String(value);
      for (const [key, item] of Object.entries(extra)) input[key] = item;
      return input;
    };

    const makePositionRow = (axis, label, value) => {
      const row = create('div', 'prop-grid-row');
      row.appendChild(create('label', '', label));
      const group = create('div', 'prop-input-group');
      const decrement = setAttributes(create('button', 'prop-step-btn', '-'), { 'data-axis': axis, 'data-dir': '-1' });
      const input = makeInput('number', `prop-input-pos-${axis}`, value, { step: '0.5' });
      const increment = setAttributes(create('button', 'prop-step-btn', '+'), { 'data-axis': axis, 'data-dir': '1' });
      group.appendChild(decrement);
      group.appendChild(input);
      group.appendChild(increment);
      row.appendChild(group);
      return row;
    };

    const makeSection = (title) => {
      const section = create('div', 'prop-section');
      section.appendChild(create('div', 'prop-section-title', title));
      return section;
    };

    const header = create('div', 'prop-entity-header');
    const icon = create('div', 'prop-entity-icon');
    icon.appendChild(setAttributes(create('span', 'icon-slot'), { 'data-omni-icon': is3D ? 'assembly' : 'studioEda' }));
    const meta = create('div', 'prop-entity-meta');
    meta.appendChild(create('div', 'prop-entity-title', props.name || 'Component'));
    meta.appendChild(create('div', 'prop-entity-type', props.type || (is3D ? 'Solid 3D Body' : 'Schematic Cell')));
    header.appendChild(icon);
    header.appendChild(meta);

    const transform = makeSection('Geometric Transform (Local Coordinates)');
    transform.appendChild(makePositionRow('x', 'Position X (mm)', posX));
    transform.appendChild(makePositionRow('y', 'Position Y (mm)', posY));
    if (is3D) transform.appendChild(makePositionRow('z', 'Position Z (mm)', posZ));

    const geometry = makeSection('Geometry and Property Data');
    if (is3D) {
      const materialRow = create('div', 'prop-grid-row');
      const materialLabel = create('label', '', 'Material label (display only)');
      materialLabel.setAttribute('for', 'prop-input-material-label');
      materialRow.appendChild(materialLabel);
      materialRow.appendChild(
        makeInput('text', 'prop-input-material-label', String(props.materialName || ''), { maxLength: 120 })
      );
      geometry.appendChild(materialRow);

      const disclosure = create('div', 'prop-grid-row');
      disclosure.appendChild(
        create('span', 'prop-dims-pill', 'Label only; no material properties or source verification are attached.')
      );
      geometry.appendChild(disclosure);

      const boundsRow = create('div', 'prop-grid-row');
      boundsRow.appendChild(create('label', '', 'Visual bounds (mm)'));
      boundsRow.appendChild(create('div', 'prop-dims-pill', dimensions));
      geometry.appendChild(boundsRow);
    } else {
      const row = create('div', 'prop-grid-row');
      row.appendChild(create('label', '', 'Width / Height'));
      const group = create('div', 'prop-input-group');
      const widthInput = makeInput('number', 'prop-input-w', width, { className: 'pgrid-field-half' });
      const heightInput = makeInput('number', 'prop-input-h', height, { className: 'pgrid-field-half' });
      group.appendChild(widthInput);
      group.appendChild(heightInput);
      row.appendChild(group);
      geometry.appendChild(row);
    }

    const elements = [header, transform, geometry];

    if (props.wbsId || props.userData?.isNasaEntity || props.userData?.isSyntheticExample) {
      const metadata = create('div', 'prop-section pgrid-metadata-section');
      const metadataTitle = create('div', 'pgrid-metadata-title', 'ILLUSTRATIVE MODEL METADATA');
      const metadataText = create(
        'div',
        'pgrid-metadata-text',
        'This geometry is not a source-verified aerospace subsystem record.'
      );
      const inspectButton = create('button', 'ribbon-btn pgrid-inspect-btn', 'View subsystem data availability');
      inspectButton.id = 'btn-inspect-wbs-entity';
      metadata.appendChild(metadataTitle);
      metadata.appendChild(metadataText);
      metadata.appendChild(inspectButton);
      elements.push(metadata);
    }

    const engineeringFields = [
      ['delay', 'Gate Delay', 'prop-input-delay'],
      ['net', 'Net / Bus', 'prop-input-net'],
      ['temp', 'Operating Temp', 'prop-input-temp'],
      ['press', 'Design Pressure', 'prop-input-press']
    ].filter(([key]) => props[key]);

    if (engineeringFields.length > 0) {
      const engineering = makeSection('Engineering Parameters');
      for (const [key, label, id] of engineeringFields) {
        const row = create('div', 'prop-grid-row');
        row.appendChild(create('label', '', label));
        row.appendChild(makeInput('text', id, String(props[key])));
        engineering.appendChild(row);
      }
      elements.push(engineering);
    }

    const actions = create('div', 'prop-section prop-actions-section');
    actions.appendChild(create('button', 'prop-action-btn prop-btn-primary', 'Apply Changes')).id = 'btn-prop-apply';
    actions.appendChild(create('button', 'prop-action-btn prop-btn-danger', 'Delete Part')).id = 'btn-prop-delete';
    elements.push(actions);

    return elements;
  }

  function readOptionalNumberInput(input) {
    const raw = String(input?.value ?? '').trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  const api = Object.freeze({ createPropertyGridElements, readOptionalNumberInput });
  if (global) global.OmniPropertyGridView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
