/**
 * OmniIcons — Native Precision Engineering SVG Icon System
 * 
 * Hand-crafted vector iconography tailored for CAD, CAE, CFD, EDA, Optics,
 * and Plant simulation workstations. Replaces all consumer emoji placeholders
 * with crisp, pixel-aligned vector graphics (1.75px optical stroke).
 * 
 * Zero external CDN dependencies. Pure inline SVG string catalog.
 */

(function (root, factory) {
  const instance = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = instance;
  }
  if (typeof root !== 'undefined') {
    root.OmniIcons = instance;
  }
  if (typeof window !== 'undefined') {
    window.OmniIcons = instance;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

  const ICONS = {
    // ----------------------------------------------------
    // Engineering Studios
    // ----------------------------------------------------
    studioConsumer: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
    studioEda: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
    studioAerospace: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    studioPlant: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M4 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0M16 19a2 2 0 1 0 4 0 2 2 0 1 0-4 0M6 17V5h12v12M6 9h12M6 13h12"/></svg>`,
    studioSimulink: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M10 6.5h4M6.5 10v4M17.5 10v4M10 17.5h4"/></svg>`,
    studioCad: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,

    // ----------------------------------------------------
    // Viewport Display & Render Style
    // ----------------------------------------------------
    solid: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 16V8l-9-5-9 5v8l9 5 9-5z"/><path d="M12 12l9-5M12 12v10M12 12L3 7"/></svg>`,
    wireframe: `<svg ${SVG_ATTRS} class="icon-svg" stroke-dasharray="2 2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/><line x1="12" y1="22" x2="12" y2="12"/><line x1="22" y1="8.5" x2="12" y2="12"/><line x1="2" y1="8.5" x2="12" y2="12"/></svg>`,
    xray: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="3" x2="12" y2="7"/><line x1="12" y1="17" x2="12" y2="21"/><line x1="3" y1="12" x2="7" y2="12"/><line x1="17" y1="12" x2="21" y2="12"/></svg>`,
    fea: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M3 3v18h18"/><path d="M18 9l-5 5-4-4-3 3"/></svg>`,
    clip: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>`,
    caliper: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 6H3v4h18V6zM3 10v4M7 10v2M11 10v4M15 10v2M19 10v4M7 14h10v4H7v-4z"/></svg>`,

    // ----------------------------------------------------
    // Camera Orientation
    // ----------------------------------------------------
    camIso: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    camTop: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="9"/><polyline points="12 8 12 16 16 12"/></svg>`,
    camFront: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="9 12 15 12 12 9"/></svg>`,
    camReset: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,

    // ----------------------------------------------------
    // CAD & Geometric Tools
    // ----------------------------------------------------
    sketcher: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/><line x1="2" y1="22" x2="22" y2="22"/></svg>`,
    fillet: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M4 4v16h16"/><path d="M4 12a8 8 0 0 1 8 8"/></svg>`,
    assembly: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="8" cy="8" r="4"/><circle cx="16" cy="16" r="4"/><path d="M10.83 10.83l2.34 2.34"/></svg>`,
    drawing2d: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`,
    sheetMetal: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="M3.3 7l8.7 5 8.7-5M12 22V12"/></svg>`,
    gdt: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="7"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/></svg>`,
    autoHeal: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    cadDiff: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7M6 9v12"/></svg>`,

    // ----------------------------------------------------
    // CAE, CFD & Simulation
    // ----------------------------------------------------
    mesher: `<svg ${SVG_ATTRS} class="icon-svg"><polygon points="12 2 2 12 12 22 22 12 12 2"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
    cfd: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M4 8h16a4 4 0 0 1-4 4H4a2 2 0 0 0 0 4h12a3 3 0 0 0 3-3"/></svg>`,
    bode: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M3 3v18h18"/><path d="M7 16c3-1 6-7 10-7 2 0 4 3 4 3"/></svg>`,
    fmi: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,

    // ----------------------------------------------------
    // EDA & Semiconductor
    // ----------------------------------------------------
    verilog: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    oscilloscope: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="2" y="3" width="20" height="15" rx="2"/><polyline points="4 11 8 11 10 7 14 15 16 11 20 11"/><line x1="6" y1="21" x2="18" y2="21"/></svg>`,
    gerber: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="7" cy="7" r="1.5"/><circle cx="17" cy="7" r="1.5"/><circle cx="17" cy="17" r="1.5"/><circle cx="7" cy="17" r="1.5"/><path d="M7 7h10v10"/></svg>`,

    // ----------------------------------------------------
    // Optics & Photonics
    // ----------------------------------------------------
    optics: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="3"/><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/></svg>`,
    dlsOpt: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>`,

    // ----------------------------------------------------
    // Plant, Piping & Pressure Vessels
    // ----------------------------------------------------
    flowsheet: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="6" width="6" height="12" rx="1"/><rect x="15" y="6" width="6" height="12" rx="1"/><path d="M9 12h6M12 9l3 3-3 3"/></svg>`,
    asme: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,

    // ----------------------------------------------------
    // PDM, eBOM & Containers
    // ----------------------------------------------------
    ebom: `<svg ${SVG_ATTRS} class="icon-svg"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><polyline points="3 6 4 7 6 5"/><polyline points="3 12 4 13 6 11"/><polyline points="3 18 4 19 6 17"/></svg>`,
    step: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    archive: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
    cloudHpc: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>`,
    auditReport: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>`,
    wizards: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,

    // ----------------------------------------------------
    // General System, Navigation & Docking Controls
    // ----------------------------------------------------
    search: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    themeDark: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
    themeLight: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    undo: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`,
    redo: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>`,
    chevronDown: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="6 9 12 15 18 9"/></svg>`,
    chevronUp: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="18 15 12 9 6 15"/></svg>`,
    chevronRight: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="9 18 15 12 9 6"/></svg>`,
    close: `<svg ${SVG_ATTRS} class="icon-svg"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    terminal: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
    aiRobot: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><circle cx="8" cy="16" r="1" fill="currentColor"/><circle cx="16" cy="16" r="1" fill="currentColor"/></svg>`,
    play: `<svg ${SVG_ATTRS} class="icon-svg"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
    pause: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
    stepBackward: `<svg ${SVG_ATTRS} class="icon-svg"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>`,
    gear: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    shieldCheck: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`,
    fileDoc: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
    check: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="20 6 9 17 4 12"/></svg>`,
    bolt: `<svg ${SVG_ATTRS} class="icon-svg"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    flame: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
    cube: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    printer: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
    maximize: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
    minimize: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,

    // ----------------------------------------------------
    // Extended Studio & Hardware Domain Symbols
    // ----------------------------------------------------
    smartphone: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`,
    cameraLens: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
    lensElement: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M7 4c4 4 4 12 0 16M17 4c-4 4-4 12 0 16"/><line x1="7" y1="4" x2="17" y2="4"/><line x1="7" y1="20" x2="17" y2="20"/></svg>`,
    aperture: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/></svg>`,
    dropTest: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 2v13M12 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM6 15l2.5-1.5M18 15l-2.5-1.5M3 21h18"/></svg>`,
    thermalCht: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>`,
    drcCheck: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="9" y2="9"/><line x1="9" y1="3" x2="9" y2="9"/><path d="M13 14l2 2 4-4"/></svg>`,
    drone: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="3"/><line x1="5" y1="5" x2="19" y2="19"/><line x1="5" y1="19" x2="19" y2="5"/><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/></svg>`,
    piping: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M3 6h6v4h6V6h6v12h-6v-4H9v4H3V6z"/></svg>`,
    distillation: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="7" y="2" width="10" height="20" rx="3"/><line x1="7" y1="7" x2="17" y2="7"/><line x1="7" y1="11" x2="17" y2="11"/><line x1="7" y1="15" x2="17" y2="15"/><line x1="7" y1="19" x2="17" y2="19"/></svg>`,
    simulink: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/><path d="M9 6h6v9"/></svg>`,
    pcbStack: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="4" width="18" height="3" rx="1"/><rect x="3" y="10" width="18" height="3" rx="1"/><rect x="3" y="16" width="18" height="3" rx="1"/></svg>`,
    spotDiagram: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="10" cy="11" r="0.75" fill="currentColor"/><circle cx="14" cy="13" r="0.75" fill="currentColor"/><circle cx="13" cy="10" r="0.75" fill="currentColor"/><circle cx="11" cy="14" r="0.75" fill="currentColor"/></svg>`,
    mtfCurve: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M3 3v18h18"/><path d="M3 6c6 0 9 10 18 15"/></svg>`,
    refresh: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,
    tree: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v9a3 3 0 0 0 3 3h6"/><path d="M6 12h12"/></svg>`,
    themeSun: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
    themeMoon: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,

    // ----------------------------------------------------
    // Production Parity & Missing UI Icons
    // ----------------------------------------------------
    checkCircle: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></svg>`,
    circuit: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M4 9h5M15 9h5M4 15h5M15 15h5M9 4v5M9 15v5M15 4v5M15 15v5"/></svg>`,
    cfdStreamlines: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M3 6h12a4 4 0 0 1 0 8H7a2 2 0 0 0 0 4h14"/><line x1="3" y1="10" x2="10" y2="10"/><line x1="3" y1="14" x2="6" y2="14"/></svg>`,
    flowChart: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="3" width="6" height="5" rx="1"/><rect x="9" y="16" width="6" height="5" rx="1"/><path d="M6 8v3h12V8M12 11v5"/></svg>`,
    solidExtrude: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 7v10M22 7v10M12 12v10"/><line x1="12" y1="2" x2="12" y2="6" stroke-width="2.5"/></svg>`,
    link: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,

    // ----------------------------------------------------
    // CAD Feature Modeling & CAM Icons
    // ----------------------------------------------------
    cadExtrude: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 2L2 7l10 5 10-5-10-5z"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/><line x1="12" y1="2" x2="12" y2="8" stroke="currentColor"/></svg>`,
    cadRevolve: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19"/><circle cx="12" cy="12" r="3"/></svg>`,
    cadSweep: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M4 19c4-1 6-5 6-9s2-6 6-6h4"/><circle cx="4" cy="19" r="2"/><rect x="16" y="2" width="6" height="6" rx="1"/></svg>`,
    cadLoft: `<svg ${SVG_ATTRS} class="icon-svg"><polygon points="6 4 18 4 15 10 9 10 6 4"/><polygon points="9 10 15 10 19 20 5 20 9 10"/><line x1="6" y1="4" x2="5" y2="20"/><line x1="18" y1="4" x2="19" y2="20"/></svg>`,
    cadShell: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1" stroke-dasharray="2 2"/></svg>`,
    cadPattern: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
    cadMirror: `<svg ${SVG_ATTRS} class="icon-svg"><line x1="12" y1="2" x2="12" y2="22" stroke-dasharray="3 3"/><polygon points="8 6 3 12 8 18 8 6"/><polygon points="16 6 21 12 16 18 16 6"/></svg>`,
    cadHole: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="1" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="23" y2="12"/></svg>`,
    camGcode: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 2v6"/><rect x="9" y="8" width="6" height="4"/><path d="M12 12v3"/><circle cx="12" cy="18" r="3"/><path d="M4 22h16"/></svg>`,
    gizmo3d: `<svg ${SVG_ATTRS} class="icon-svg"><line x1="12" y1="12" x2="20" y2="12" stroke="#f87171" stroke-width="2.5"/><line x1="12" y1="12" x2="12" y2="4" stroke="#4ade80" stroke-width="2.5"/><line x1="12" y1="12" x2="6" y2="18" stroke="#38bdf8" stroke-width="2.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`,
    contextMenu: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="14" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>`,
    historyStack: `<svg ${SVG_ATTRS} class="icon-svg"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/></svg>`,
    cursor: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M4 4l7 17 2.5-6.5L20 12 4 4z"/></svg>`,
    plus: `<svg ${SVG_ATTRS} class="icon-svg"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    trash: `<svg ${SVG_ATTRS} class="icon-svg"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    chartLine: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M3 3v18h18"/><path d="M19 9l-5 5-4-4-3 3"/></svg>`,
    designSystem: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/><circle cx="6" cy="6" r="1.5"/></svg>`,
    anatomyCard: `<svg ${SVG_ATTRS} class="icon-svg"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/><circle cx="6" cy="6" r="1.5"/></svg>`,
    rocket: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4.5c1.62-1.63 5-2.5 5-2.5"/><path d="M12 15v5s3.03-.55 4.5-2c1.63-1.62 2.5-5 2.5-5"/></svg>`,
    spaceEngine: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M8 3h8l2 6H6l2-6zM6 9l-2 10h16L18 9M10 19v2M14 19v2M7 19c0 2 2 3 5 3s5-1 5-3"/><circle cx="12" cy="6" r="1"/></svg>`,
    shield: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    info: `<svg ${SVG_ATTRS} class="icon-svg"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    satellite: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m8 12 4 4 6-6-4-4Z"/><path d="m16 8 3-3"/><path d="M9 21a6 6 0 0 0-6-6"/></svg>`,
    download: `<svg ${SVG_ATTRS} class="icon-svg"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
  };

  return {
    get: function (name) {
      return ICONS[name] || '';
    },
    has: function (name) {
      return Boolean(ICONS[name]);
    },
    getAll: function () {
      return ICONS;
    },
    getAllKeys: function () {
      return Object.keys(ICONS);
    },
    hydrateAll: function (container) {
      const root = container || document;
      if (!root.querySelectorAll) return;
      const slots = root.querySelectorAll('[data-omni-icon]');
      slots.forEach(slot => {
        const iconKey = slot.getAttribute('data-omni-icon');
        if (ICONS[iconKey]) {
          slot.innerHTML = ICONS[iconKey];
        }
      });
    },
    hydrateIcons: function (container) {
      return this.hydrateAll(container);
    }
  };
});
