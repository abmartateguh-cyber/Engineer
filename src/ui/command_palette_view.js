/**
 * DOM-only construction for command-palette result rows.
 */
'use strict';

(function attachCommandPaletteView(global) {
  function asText(value) {
    return typeof value === 'string' ? value : '';
  }

  function createCommandPaletteItem(documentRef, command = {}, index = 0, selected = false) {
    if (!documentRef || typeof documentRef.createElement !== 'function') {
      throw new TypeError('A document with createElement is required to build a command-palette item.');
    }

    const item = documentRef.createElement('div');
    item.className = selected ? 'command-item selected' : 'command-item';
    item.setAttribute('data-cmd-index', String(index));
    item.setAttribute('data-cmd-id', asText(command.id));

    const left = documentRef.createElement('div');
    left.className = 'command-item-left';

    const icon = documentRef.createElement('span');
    icon.className = 'command-item-icon icon-slot';
    icon.setAttribute('data-omni-icon', asText(command.icon));
    left.appendChild(icon);

    const textContainer = documentRef.createElement('div');
    const title = documentRef.createElement('div');
    title.className = 'command-item-title';
    title.textContent = asText(command.title);
    textContainer.appendChild(title);

    const description = documentRef.createElement('div');
    description.className = 'command-item-desc';
    description.textContent = asText(command.desc);
    textContainer.appendChild(description);
    left.appendChild(textContainer);
    item.appendChild(left);

    const right = documentRef.createElement('div');
    right.className = 'command-item-right';
    const category = documentRef.createElement('span');
    category.className = 'command-item-category';
    category.textContent = asText(command.category);
    right.appendChild(category);
    item.appendChild(right);

    return item;
  }

  const api = Object.freeze({ createCommandPaletteItem });
  if (global) global.OmniCommandPaletteView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
