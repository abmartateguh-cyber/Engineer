/**
 * OmniEng Modeless Docking Panel Manager
 * 
 * Replaces blocking modal dialogs with flexible CAD workstation docking panels:
 *   - Allows tools (Optics, SPICE Scope, Flowsheet PFD, Healer, ASME Report, CAD Diff)
 *     to be docked into Left Sidebar, Right Inspector, Bottom Dock, or Float.
 *   - Supports layout saving and restoration to localStorage.
 *   - Supports tear-off to child window or modeless floating container.
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
    this.detachedWindows = new Map();
    this.storageKey = 'omnieng_workstation_dock_layout';
  }

  registerPanel(panelId, element, options = {}) {
    this.panels.set(panelId, {
      id: panelId,
      element,
      title: options.title || panelId,
      preferredSlot: options.preferredSlot || 'bottom',
      currentSlot: null,
      isOpen: false,
      floatingBounds: { top: 80, left: 100, width: 560, height: 480 },
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
      if (panel.currentSlot === 'floating') {
        panel.element.classList.add('dock-panel-floating');
        panel.element.style.top = `${panel.floatingBounds.top}px`;
        panel.element.style.left = `${panel.floatingBounds.left}px`;
        panel.element.style.width = `${panel.floatingBounds.width}px`;
        panel.element.style.height = `${panel.floatingBounds.height}px`;
      }
    }

    if (panel.onOpen) {
      panel.onOpen(panel);
    }
    this.saveLayout();
    return true;
  }

  closePanel(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel) return false;

    panel.isOpen = false;
    if (panel.element) {
      panel.element.classList.remove('active');
      panel.element.classList.remove('dock-panel-floating');
    }

    if (panel.onClose) {
      panel.onClose(panel);
    }
    this.saveLayout();
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

  floatPanel(panelId, bounds = {}) {
    const panel = this.panels.get(panelId);
    if (!panel) return false;

    panel.floatingBounds = Object.assign(panel.floatingBounds, bounds);
    return this.openPanel(panelId, 'floating');
  }

  tearOffPanel(panelId) {
    const panel = this.panels.get(panelId);
    if (!panel) return false;

    // Check if electron window opening is available, else float
    if (typeof window !== 'undefined' && window.open) {
      const childWin = window.open(`ui/panel_host.html?panelId=${encodeURIComponent(panelId)}`, `Omni_${panelId}`, 'width=600,height=500,resizable=yes');
      if (childWin) {
        this.detachedWindows.set(panelId, childWin);
        this.closePanel(panelId);
        return true;
      }
    }
    return this.floatPanel(panelId);
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

  saveLayout() {
    try {
      if (typeof localStorage === 'undefined') return;
      const layout = {};
      for (const [id, panel] of this.panels.entries()) {
        layout[id] = {
          isOpen: panel.isOpen,
          slot: panel.currentSlot,
          floatingBounds: panel.floatingBounds
        };
      }
      localStorage.setItem(this.storageKey, JSON.stringify(layout));
    } catch (_) {}
  }

  restoreLayout() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const layout = JSON.parse(raw);
      for (const [id, state] of Object.entries(layout)) {
        const panel = this.panels.get(id);
        if (panel && state.isOpen) {
          panel.floatingBounds = state.floatingBounds || panel.floatingBounds;
          this.openPanel(id, state.slot);
        }
      }
    } catch (_) {}
  }
}

// Support both CommonJS and browser window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DockingManager };
}
if (typeof window !== 'undefined') {
  window.DockingManager = DockingManager;
}
