/**
 * Local keyboard shortcut profiles for OmniEng workstation controls.
 * Named presets map selected key combinations; they do not provide integration with the
 * applications whose shortcut conventions they reference.
 */

'use strict';

const KEYMAP_PROFILES = {
  OMNIENG_DEFAULT: {
    name: 'OmniEng Workstation Standard',
    bindings: {
      'KeyF': 'ACTION_FIT_VIEWPORT',
      'KeyI': 'ACTION_VIEW_ISOMETRIC',
      'Digit1': 'ACTION_VIEW_SOLID',
      'Digit2': 'ACTION_VIEW_WIREFRAME',
      'Digit3': 'ACTION_VIEW_XRAY',
      'Digit4': 'ACTION_VIEW_FEA_STRESS',
      'KeyC': 'ACTION_TOGGLE_SECTION_CLIP',
      'KeyM': 'ACTION_TOGGLE_CALIPER_MEASURE',
      'Ctrl+KeyK': 'ACTION_OPEN_COMMAND_PALETTE',
      'Ctrl+KeyJ': 'ACTION_TOGGLE_AI_DOCK',
      'Ctrl+KeyS': 'ACTION_SAVE_PROJECT',
      'Ctrl+KeyZ': 'ACTION_UNDO',
      'Ctrl+KeyY': 'ACTION_REDO',
      'Ctrl+Alt+KeyQ': 'ACTION_TOGGLE_QUAD_VIEW'
    }
  },
  CATIA_V5: {
    name: 'Dassault Systèmes CATIA V5',
    bindings: {
      'F3': 'ACTION_TOGGLE_SPEC_TREE',
      'KeyF': 'ACTION_FIT_VIEWPORT',
      'Ctrl+KeyK': 'ACTION_OPEN_COMMAND_PALETTE',
      'Ctrl+KeyZ': 'ACTION_UNDO',
      'Ctrl+KeyY': 'ACTION_REDO',
      'Digit1': 'ACTION_VIEW_SOLID',
      'Digit2': 'ACTION_VIEW_WIREFRAME',
      'KeyM': 'ACTION_TOGGLE_CALIPER_MEASURE'
    }
  },
  SIEMENS_NX: {
    name: 'Siemens NX / Unigraphics',
    bindings: {
      'Home': 'ACTION_FIT_VIEWPORT',
      'End': 'ACTION_VIEW_ISOMETRIC',
      'F8': 'ACTION_ALIGN_ORTHOGONAL_VIEW',
      'Ctrl+KeyS': 'ACTION_SAVE_PROJECT',
      'Ctrl+KeyZ': 'ACTION_UNDO',
      'Ctrl+KeyY': 'ACTION_REDO'
    }
  },
  SOLIDWORKS: {
    name: 'Dassault SolidWorks',
    bindings: {
      'KeyF': 'ACTION_FIT_VIEWPORT',
      'Ctrl+Digit7': 'ACTION_VIEW_ISOMETRIC',
      'Space': 'ACTION_OPEN_ORIENTATION_DIALOG',
      'KeyZ': 'ACTION_ZOOM_OUT',
      'Shift+KeyZ': 'ACTION_ZOOM_IN'
    }
  },
  BLENDER: {
    name: 'Blender 4.x',
    bindings: {
      'Numpad1': 'ACTION_VIEW_FRONT',
      'Numpad3': 'ACTION_VIEW_RIGHT',
      'Numpad7': 'ACTION_VIEW_TOP',
      'Numpad0': 'ACTION_VIEW_CAMERA',
      'Numpad5': 'ACTION_TOGGLE_PERSP_ORTHO',
      'KeyG': 'ACTION_TRANSLATE_SELECTION',
      'KeyR': 'ACTION_ROTATE_SELECTION',
      'KeyS': 'ACTION_SCALE_SELECTION'
    }
  }
};

class KeymapManager {
  constructor(activeProfile = 'OMNIENG_DEFAULT') {
    this.currentProfile = activeProfile;
    this.customBindings = new Map();
    this.actionListeners = new Map();
  }

  setProfile(profileName) {
    if (!KEYMAP_PROFILES[profileName]) {
      throw new Error(`Unknown keymap profile: ${profileName}`);
    }
    this.currentProfile = profileName;
    return KEYMAP_PROFILES[profileName];
  }

  getProfilesList() {
    return Object.keys(KEYMAP_PROFILES).map(key => ({
      key,
      name: KEYMAP_PROFILES[key].name,
      isActive: key === this.currentProfile
    }));
  }

  getBinding(keyCombination) {
    // Custom user override takes precedence
    if (this.customBindings.has(keyCombination)) {
      return this.customBindings.get(keyCombination);
    }
    const profile = KEYMAP_PROFILES[this.currentProfile];
    return profile ? profile.bindings[keyCombination] || null : null;
  }

  setCustomBinding(keyCombination, actionId) {
    this.customBindings.set(keyCombination, actionId);
    this.saveToStorage();
  }

  resetCustomBindings() {
    this.customBindings.clear();
    this.saveToStorage();
  }

  exportCustomBindings() {
    const obj = {};
    for (const [k, v] of this.customBindings.entries()) {
      obj[k] = v;
    }
    return JSON.stringify({ profile: this.currentProfile, bindings: obj }, null, 2);
  }

  importCustomBindings(jsonString) {
    try {
      const data = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
      if (data.profile && KEYMAP_PROFILES[data.profile]) {
        this.setProfile(data.profile);
      }
      if (data.bindings) {
        for (const [k, v] of Object.entries(data.bindings)) {
          this.customBindings.set(k, v);
        }
      }
      this.saveToStorage();
      return true;
    } catch (_) {
      return false;
    }
  }

  saveToStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      const data = {
        profile: this.currentProfile,
        custom: Object.fromEntries(this.customBindings)
      };
      localStorage.setItem('omnieng_workstation_keymaps', JSON.stringify(data));
    } catch (_) {}
  }

  restoreFromStorage() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem('omnieng_workstation_keymaps');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.profile && KEYMAP_PROFILES[data.profile]) {
        this.currentProfile = data.profile;
      }
      if (data.custom) {
        for (const [k, v] of Object.entries(data.custom)) {
          this.customBindings.set(k, v);
        }
      }
    } catch (_) {}
  }

  onAction(actionId, callback) {
    if (!this.actionListeners.has(actionId)) {
      this.actionListeners.set(actionId, []);
    }
    this.actionListeners.get(actionId).push(callback);
  }

  dispatchAction(actionId, event = null) {
    const listeners = this.actionListeners.get(actionId);
    if (listeners) {
      for (const cb of listeners) {
        cb(event);
      }
      return true;
    }
    return false;
  }

  handleKeyboardEvent(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    parts.push(event.code || event.key);

    const combo = parts.join('+');
    const action = this.getBinding(combo);
    if (action) {
      event.preventDefault();
      this.dispatchAction(action, event);
      return true;
    }
    return false;
  }
}

// Support both CommonJS and browser window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KeymapManager, KEYMAP_PROFILES };
}
if (typeof window !== 'undefined') {
  window.KeymapManager = KeymapManager;
  window.KEYMAP_PROFILES = KEYMAP_PROFILES;
}
