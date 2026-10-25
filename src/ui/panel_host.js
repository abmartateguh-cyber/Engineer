'use strict';

const urlParams = new URLSearchParams(window.location.search);
const panelId = urlParams.get('panelId') || 'Unknown Panel';
const panelTitle = document.getElementById('panel-title');
panelTitle.textContent = panelId.replace('modal-', '').replace(/-/g, ' ').toUpperCase();
document.title = `OmniEng - ${panelTitle.textContent}`;

document.getElementById('btn-dock-back').addEventListener('click', () => {
  window.close();
});
