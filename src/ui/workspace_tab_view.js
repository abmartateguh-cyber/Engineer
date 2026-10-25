/**
 * DOM-only workspace-tab construction for document labels and metadata.
 */
'use strict';

(function attachWorkspaceTabView(global) {
  function createWorkspaceTab(documentRef, options = {}) {
    if (!documentRef || typeof documentRef.createElement !== 'function') {
      throw new TypeError('A document with createElement is required to build a workspace tab.');
    }

    const tab = documentRef.createElement('div');
    tab.className = options.active === false ? 'workspace-tab' : 'workspace-tab active';
    tab.setAttribute('data-doc-id', String(options.docId ?? ''));

    const icon = documentRef.createElement('span');
    icon.className = 'doc-icon icon-slot';
    icon.setAttribute('data-omni-icon', 'fileDoc');
    tab.appendChild(icon);

    const title = documentRef.createElement('span');
    title.className = 'doc-title';
    title.textContent = String(options.title ?? 'Untitled');
    tab.appendChild(title);

    const badge = documentRef.createElement('span');
    badge.className = 'doc-badge';
    badge.textContent = String(options.badge ?? '');
    tab.appendChild(badge);

    const closeButton = documentRef.createElement('span');
    closeButton.className = 'doc-close-btn';
    closeButton.textContent = '×';
    tab.appendChild(closeButton);

    return tab;
  }

  const api = Object.freeze({ createWorkspaceTab });
  if (global) global.OmniWorkspaceTabView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
