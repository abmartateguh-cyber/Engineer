/**
 * OmniEng Modeless Docking Panel Manager
 * 
 * Replaces blocking modal dialogs with flexible CAD workstation docking panels:
 *   - Allows tools (Optics, SPICE Scope, Flowsheet PFD, Healer, ASME Report, CAD Diff)
 *     to be docked into Left Sidebar, Right Inspector, Bottom Dock, or Float.
 *   - Maintains 100% backward compatibility with all legacy modal IDs and test selectors.
 */

'use strict';

class DockingManager {
  constructor() {
    this.panels = new Map();
    this.dockSlots = {
      left: null,
      right: null,
      bottom: null,
      floating: []
    };
  }

  registerPanel(panelId, element, options = {}) {
    this.panels.set(panelId, {
      id: panelId,
      element,
      title: options.title || panelId,
      preferredSlot: options.preferredSlot || 'bottom',
      currentSlot: null,
      isOpen: false,
      onOpen: options.onOpen || null,
      onClose: options.onClose || null
    });
  }

  openPanel(panelId, slot = null) {
    const panel = this.panels.get(panelId);
    if (!panel) return false;

    panel.currentSlot = slot || panel.preferredSlot;
    panel.isOpen = true;

    if (panel.element) {
      panel.element.classList.add('active');
      panel.element.setAttribute('data-dock-slot', panel.currentSlot);
    }

    if (panel.onOpen) {
      panel.onOpen(panel);
    }
    return true;
  }

  closePanel(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel) return false;

    panel.isOpen = false;
    if (panel.element) {
      panel.element.classList.remove('active');
    }

    if (panel.onClose) {
      panel.onClose(panel);
    }
    return true;
  }

  togglePanel(panelId, slot = null) {
    const panel = this.panels.get(panelId);
    if (!panel) return false;

    if (panel.isOpen) {
      return this.closePanel(panelId);
    } else {
      return this.openPanel(panelId, slot);
    }
  }

  isPanelOpen(panelId) {
    const panel = this.panels.get(panelId);
    return panel ? panel.isOpen : false;
  }

  getActivePanels() {
    return Array.from(this.panels.values())
      .filter(p => p.isOpen)
      .map(p => ({ id: p.id, title: p.title, slot: p.currentSlot }));
  }
}

// Support both CommonJS and browser window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DockingManager };
}
if (typeof window !== 'undefined') {
  window.DockingManager = DockingManager;
}
