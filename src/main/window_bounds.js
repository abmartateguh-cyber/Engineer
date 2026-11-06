'use strict';

/**
 * Window sizing geometry for the workstation main window.
 *
 * All bounds are derived from the primary display work area (the usable region
 * below the menu bar / dock / taskbar). The window is never allowed to exceed
 * the work area on either axis, which eliminates bottom/right clipping on
 * small displays (for example a 1440x900 display with an ~835 px tall usable
 * work area, or a 1024x600 display with an ~560 px tall work area).
 */

const DEFAULT_MAX_WIDTH = 1440;
const DEFAULT_MAX_HEIGHT = 840;
const MIN_WIDTH_FLOOR = 320;
const MIN_HEIGHT_FLOOR = 240;

function computeWindowBounds(workArea = { width: 1440, height: 900 }) {
  const workW = Math.floor(Number(workArea && workArea.width) || 1440);
  const workH = Math.floor(Number(workArea && workArea.height) || 900);

  const width = Math.min(DEFAULT_MAX_WIDTH, Math.max(MIN_WIDTH_FLOOR, workW));
  const height = Math.min(DEFAULT_MAX_HEIGHT, Math.max(MIN_HEIGHT_FLOOR, workH));
  const minWidth = Math.min(1024, workW);
  const minHeight = Math.min(680, workH);

  return { width, height, minWidth, minHeight };
}

module.exports = { computeWindowBounds };
