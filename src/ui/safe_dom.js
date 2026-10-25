/**
 * Small DOM helpers for rendering user supplied text without treating it as HTML.
 */

'use strict';

(function attachSafeDom(global) {
  function appendSafeInlineMarkup(target, value) {
    const source = String(value ?? '');
    const tokenPattern = /<\/?(?:strong|em|code)>|<br\s*\/?>/gi;
    const parents = [target];
    const openTags = [];
    let cursor = 0;
    let match;

    function appendText(text) {
      if (text) parents[parents.length - 1].appendChild(global.document.createTextNode(text));
    }

    while ((match = tokenPattern.exec(source)) !== null) {
      appendText(source.slice(cursor, match.index));
      cursor = tokenPattern.lastIndex;

      const token = match[0].toLowerCase();
      if (token.startsWith('<br')) {
        parents[parents.length - 1].appendChild(global.document.createElement('br'));
        continue;
      }

      const closing = token.startsWith('</');
      const tagName = token.replace(/[</>]/g, '');
      if (closing) {
        const openIndex = openTags.lastIndexOf(tagName);
        if (openIndex >= 0) {
          openTags.length = openIndex;
          parents.length = openIndex + 1;
        }
        continue;
      }

      const element = global.document.createElement(tagName);
      parents[parents.length - 1].appendChild(element);
      openTags.push(tagName);
      parents.push(element);
    }

    appendText(source.slice(cursor));
  }

  const api = Object.freeze({ appendSafeInlineMarkup });
  if (global) global.OmniSafeDOM = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : window);
