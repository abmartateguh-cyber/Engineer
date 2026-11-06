/**
 * Industrial Cause & Effect (C&E) Matrix Engine & SVG/CSV Generator.
 *
 * Implements standard process industry shutdown logic matrices:
 *  - Trip causes: Process transmitters (PAHH, PALL, LAHH, LALL, TAHH, TALL),
 *    Fire & Gas confirmed signals, and manual ESD pushbuttons.
 *  - Voting logic: 1oo1, 1oo2, 2oo2, 2oo3.
 *  - Executive shutdown levels:
 *      * ESD Level 0: Total Plant Abandonment & Depressuring (Blowdown)
 *      * ESD Level 1: Process Train Shutdown & Depressuring
 *      * ESD Level 2: Unit Isolation (Safe hold)
 *      * ESD Level 3: Individual Equipment Trip
 *  - Action intersection types:
 *      * 'X': Immediate trip / close / open
 *      * 'T': Timed delayed trip (e.g. delaySec)
 *      * 'R': Restart inhibit / interlock
 *      * 'A': Alarm notification only
 *  - Real-time logic solver evaluation given active sensor inputs.
 *  - High-resolution SVG schematic diagram and RFC 4180 CSV export.
 */

'use strict';

/**
 * Escape XML special characters.
 * @param {string|number|null} str
 * @returns {string}
 */
function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Standard ESD hierarchy levels.
 */
const ESD_LEVELS = Object.freeze({
  LEVEL_0: {
    level: 0,
    code: 'ESD-0',
    title: 'Total Plant Abandonment & Depressuring',
    description: 'Emergency depressuring (blowdown) and total facility isolation'
  },
  LEVEL_1: {
    level: 1,
    code: 'ESD-1',
    title: 'Process Train Shutdown & Depressuring',
    description: 'Complete train isolation and controlled depressurization'
  },
  LEVEL_2: {
    level: 2,
    code: 'ESD-2',
    title: 'Unit Isolation (Safe Hold)',
    description: 'Unit-level shutdown and inventory containment without train blowdown'
  },
  LEVEL_3: {
    level: 3,
    code: 'ESD-3',
    title: 'Individual Equipment Trip',
    description: 'Specific machine, pump, compressor, or heater isolation'
  }
});

/**
 * Cause definition in the C&E Matrix.
 */
class CauseDefinition {
  /**
   * @param {Object} spec
   * @param {string} spec.id Unique cause ID (e.g. 'C-01')
   * @param {string} spec.tag Process tag (e.g. 'PAHH-1001')
   * @param {string} spec.description Description of process cause
   * @param {'PAHH'|'PALL'|'LAHH'|'LALL'|'TAHH'|'TALL'|'GAS_HIGH'|'FIRE_CONFIRMED'|'ESD_PB'|'CUSTOM'} spec.category
   * @param {'1oo1'|'1oo2'|'2oo2'|'2oo3'} [spec.voting='1oo1'] Input voting logic
   * @param {number} [spec.setpoint] Numerical trip setpoint (if analog transmitter)
   * @param {string} [spec.unit] Engineering unit (e.g. 'barg', '°C', '%', '% LEL')
   * @param {string[]} [spec.inputs] List of channel tags contributing to voting (e.g. ['PT-1001A', 'PT-1001B', 'PT-1001C'])
   */
  constructor(spec) {
    this.id = spec.id;
    this.tag = spec.tag;
    this.description = spec.description || '';
    this.category = spec.category || 'CUSTOM';
    this.voting = spec.voting || '1oo1';
    this.setpoint = spec.setpoint !== undefined ? spec.setpoint : null;
    this.unit = spec.unit || '';
    this.inputs = spec.inputs || [this.tag];
  }

  /**
   * Evaluate whether this cause is active given current channel states or values.
   * @param {Object<string, boolean|number>} inputStates Map of channel tag to value or boolean
   * @returns {boolean} True if cause trip condition is met
   */
  isTripped(inputStates) {
    if (!inputStates) return false;

    // Check direct tag override
    if (typeof inputStates[this.id] === 'boolean') return inputStates[this.id];
    if (typeof inputStates[this.tag] === 'boolean') return inputStates[this.tag];

    // Evaluate individual channels
    const channelActive = [];
    for (const channelTag of this.inputs) {
      const val = inputStates[channelTag];
      if (typeof val === 'boolean') {
        channelActive.push(val);
      } else if (typeof val === 'number' && this.setpoint !== null) {
        if (this.category === 'PAHH' || this.category === 'LAHH' || this.category === 'TAHH' || this.category === 'GAS_HIGH') {
          channelActive.push(val >= this.setpoint);
        } else if (this.category === 'PALL' || this.category === 'LALL' || this.category === 'TALL') {
          channelActive.push(val <= this.setpoint);
        } else {
          channelActive.push(val >= this.setpoint);
        }
      } else {
        channelActive.push(false);
      }
    }

    const activeCount = channelActive.filter(Boolean).length;
    const n = channelActive.length || 1;

    switch (this.voting) {
      case '1oo1':
      case '1oo2':
        return activeCount >= 1;
      case '2oo2':
      case '2oo3':
        return activeCount >= 2;
      default: {
        // Parse custom e.g. "MooN" (e.g. 2oo4, 3oo4, 10oo12)
        const match = String(this.voting).match(/^(\d+)oo(\d+|N)$/i);
        if (match) {
          const m = parseInt(match[1], 10);
          return activeCount >= m;
        }
        return activeCount >= 1;
      }
    }
  }
}

/**
 * Effect definition in the C&E Matrix.
 */
class EffectDefinition {
  /**
   * @param {Object} spec
   * @param {string} spec.id Unique effect ID (e.g. 'E-01')
   * @param {string} spec.tag Final element / action tag (e.g. 'XV-1001', 'BDV-1001', 'M-2001')
   * @param {string} spec.description Description of action
   * @param {0|1|2|3} spec.esdLevel ESD hierarchy level
   * @param {'CLOSE'|'OPEN'|'TRIP'|'DE_ENERGIZE'|'START'|'ALARM'} [spec.action='CLOSE'] Physical action
   * @param {string} [spec.subsystem] Associated equipment or area (e.g. 'LNG Storage', 'MCHE')
   */
  constructor(spec) {
    this.id = spec.id;
    this.tag = spec.tag;
    this.description = spec.description || '';
    this.esdLevel = spec.esdLevel !== undefined ? spec.esdLevel : 2;
    this.action = spec.action || 'CLOSE';
    this.subsystem = spec.subsystem || 'Process';
  }
}

/**
 * Master Cause & Effect Matrix Engine.
 */
class CauseEffectMatrix {
  /**
   * @param {Object} [spec]
   * @param {string} [spec.title='Process Plant Cause & Effect Matrix']
   * @param {string} [spec.docNumber='CE-DWG-001']
   * @param {string} [spec.revision='Rev 0']
   */
  constructor(spec = {}) {
    this.title = spec.title || 'LNG Complex Emergency Shutdown Cause & Effect Matrix';
    this.docNumber = spec.docNumber || 'CE-DWG-001';
    this.revision = spec.revision || 'Rev 0';
    this.causes = [];
    this.effects = [];
    // Map of `${causeId}:${effectId}` -> { actionCode: 'X'|'T'|'R'|'A', delaySec?: number }
    this.intersections = new Map();
  }

  /**
   * Add a trip cause.
   * @param {CauseDefinition|Object} cause
   * @returns {CauseDefinition}
   */
  addCause(cause) {
    const c = cause instanceof CauseDefinition ? cause : new CauseDefinition(cause);
    if (this.causes.some((existing) => existing.id === c.id)) {
      throw new Error(`Duplicate cause ID: ${c.id}`);
    }
    this.causes.push(c);
    return c;
  }

  /**
   * Add an executive action / effect.
   * @param {EffectDefinition|Object} effect
   * @returns {EffectDefinition}
   */
  addEffect(effect) {
    const e = effect instanceof EffectDefinition ? effect : new EffectDefinition(effect);
    if (this.effects.some((existing) => existing.id === e.id)) {
      throw new Error(`Duplicate effect ID: ${e.id}`);
    }
    this.effects.push(e);
    return e;
  }

  /**
   * Link a cause to an effect.
   * @param {string} causeId
   * @param {string} effectId
   * @param {'X'|'T'|'R'|'A'} [actionCode='X']
   * @param {number} [delaySec=0]
   */
  link(causeId, effectId, actionCode = 'X', delaySec = 0) {
    const causeExists = this.causes.some((c) => c.id === causeId);
    const effectExists = this.effects.some((e) => e.id === effectId);
    if (!causeExists) throw new Error(`Cause ID not found: ${causeId}`);
    if (!effectExists) throw new Error(`Effect ID not found: ${effectId}`);

    const key = `${causeId}:${effectId}`;
    this.intersections.set(key, { actionCode, delaySec });
  }

  /**
   * Get link at intersection.
   * @param {string} causeId
   * @param {string} effectId
   * @returns {{actionCode:string, delaySec:number}|null}
   */
  getIntersection(causeId, effectId) {
    const key = `${causeId}:${effectId}`;
    return this.intersections.get(key) || null;
  }

  /**
   * Evaluate the matrix given current plant input conditions.
   * @param {Object<string, boolean|number>} inputStates Map of channel/cause tags to states
   * @returns {Object} Active causes, active effects grouped by ESD level, and triggered actions
   */
  evaluate(inputStates) {
    const activeCauses = [];
    for (const cause of this.causes) {
      if (cause.isTripped(inputStates)) {
        activeCauses.push(cause);
      }
    }

    const triggeredEffectsMap = new Map();

    for (const cause of activeCauses) {
      for (const effect of this.effects) {
        const link = this.getIntersection(cause.id, effect.id);
        if (link) {
          if (!triggeredEffectsMap.has(effect.id)) {
            triggeredEffectsMap.set(effect.id, {
              effect,
              actionCode: link.actionCode,
              delaySec: link.delaySec,
              triggeredByCauses: [cause.tag]
            });
          } else {
            const entry = triggeredEffectsMap.get(effect.id);
            entry.triggeredByCauses.push(cause.tag);
            // 'X' overrides 'T' (immediate shutdown takes priority over delayed)
            if (link.actionCode === 'X') {
              entry.actionCode = 'X';
              entry.delaySec = 0;
            }
          }
        }
      }
    }

    const activeEffects = Array.from(triggeredEffectsMap.values());
    const groupedByLevel = {
      level0: activeEffects.filter((e) => e.effect.esdLevel === 0),
      level1: activeEffects.filter((e) => e.effect.esdLevel === 1),
      level2: activeEffects.filter((e) => e.effect.esdLevel === 2),
      level3: activeEffects.filter((e) => e.effect.esdLevel === 3)
    };

    return {
      activeCausesCount: activeCauses.length,
      activeCauses: activeCauses.map((c) => ({ id: c.id, tag: c.tag, description: c.description })),
      totalEffectsTriggered: activeEffects.length,
      activeEffects,
      groupedByLevel
    };
  }

  /**
   * Export matrix to standard RFC 4180 CSV string.
   * @returns {string} CSV text
   */
  toCsv() {
    const lines = [];

    // Title header
    lines.push(`"${this.title}","Doc: ${this.docNumber}","Rev: ${this.revision}"`);
    lines.push('');

    // Effect headers
    const row1 = ['Cause ID', 'Cause Tag', 'Description', 'Category', 'Voting', 'Setpoint', 'Unit'];
    const row2 = ['', '', '', '', '', '', 'ESD Level:'];
    const row3 = ['', '', '', '', '', '', 'Action:'];

    for (const effect of this.effects) {
      row1.push(effect.tag);
      row2.push(`Level ${effect.esdLevel}`);
      row3.push(effect.action);
    }

    lines.push(row1.map((cell) => `"${cell}"`).join(','));
    lines.push(row2.map((cell) => `"${cell}"`).join(','));
    lines.push(row3.map((cell) => `"${cell}"`).join(','));

    // Cause rows
    for (const cause of this.causes) {
      const row = [
        cause.id,
        cause.tag,
        cause.description,
        cause.category,
        cause.voting,
        cause.setpoint !== null ? String(cause.setpoint) : '',
        cause.unit
      ];

      for (const effect of this.effects) {
        const link = this.getIntersection(cause.id, effect.id);
        if (link) {
          const val = link.actionCode === 'T' && link.delaySec > 0 ? `T(${link.delaySec}s)` : link.actionCode;
          row.push(val);
        } else {
          row.push('');
        }
      }
      lines.push(row.map((cell) => `"${cell}"`).join(','));
    }

    return lines.join('\n');
  }

  /**
   * Export matrix as a high-clarity SVG drawing.
   * @param {Object} [options]
   * @param {number} [options.cellWidth=60]
   * @param {number} [options.cellHeight=26]
   * @returns {string} SVG xml text
   */
  toSvg(options = {}) {
    const cellW = options.cellWidth || 65;
    const cellH = options.cellHeight || 28;
    const causeHeaderW = 340; // Cause info columns
    const effectHeaderH = 140; // Effect header rows
    const margin = 40;

    const numCauses = this.causes.length;
    const numEffects = this.effects.length;

    const width = margin * 2 + causeHeaderW + numEffects * cellW;
    const height = margin * 2 + effectHeaderH + numCauses * cellH + 80;

    let svg = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    svg += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial, sans-serif" font-size="11">\n`;
    svg += `  <style>\n`;
    svg += `    .grid { stroke: #cccccc; stroke-width: 1; }\n`;
    svg += `    .header-box { fill: #f0f4f8; stroke: #4a5568; stroke-width: 1; }\n`;
    svg += `    .esd-0 { fill: #fed7d7; }\n`;
    svg += `    .esd-1 { fill: #feebc8; }\n`;
    svg += `    .esd-2 { fill: #fefcbf; }\n`;
    svg += `    .esd-3 { fill: #c6f6d5; }\n`;
    svg += `    .badge-x { fill: #e53e3e; font-weight: bold; fill-opacity: 0.9; }\n`;
    svg += `    .badge-t { fill: #dd6b20; font-weight: bold; fill-opacity: 0.9; }\n`;
    svg += `    .badge-r { fill: #3182ce; font-weight: bold; fill-opacity: 0.9; }\n`;
    svg += `    .badge-a { fill: #d69e2e; font-weight: bold; fill-opacity: 0.9; }\n`;
    svg += `    .text-title { font-size: 16px; font-weight: bold; fill: #1a202c; }\n`;
    svg += `    .text-sub { font-size: 11px; fill: #4a5568; }\n`;
    svg += `    .text-label { font-size: 10px; fill: #2d3748; }\n`;
    svg += `  </style>\n`;

    // Background
    svg += `  <rect width="100%" height="100%" fill="#ffffff" />\n`;

    // Title block
    svg += `  <g transform="translate(${margin}, 25)">\n`;
    svg += `    <text class="text-title" x="0" y="0">${escapeXml(this.title)}</text>\n`;
    svg += `    <text class="text-sub" x="0" y="16">Doc Number: ${escapeXml(this.docNumber)} | Revision: ${escapeXml(this.revision)} | Generated: Engineering Engine</text>\n`;
    svg += `  </g>\n`;

    const startX = margin + causeHeaderW;
    const startY = margin + effectHeaderH;

    // Cause Headers Background
    svg += `  <rect x="${margin}" y="${startY}" width="${causeHeaderW}" height="${numCauses * cellH}" fill="#f7fafc" stroke="#a0aec0" />\n`;

    // Effect Headers (Columns)
    for (let j = 0; j < numEffects; j++) {
      const e = this.effects[j];
      const x = startX + j * cellW;
      const esdClass = e.esdLevel === 0 ? 'esd-0' : e.esdLevel === 1 ? 'esd-1' : e.esdLevel === 2 ? 'esd-2' : 'esd-3';

      svg += `  <rect x="${x}" y="${margin + 40}" width="${cellW}" height="${effectHeaderH - 40}" class="${esdClass}" stroke="#cbd5e0" />\n`;
      // Rotated text for tag and description
      svg += `  <g transform="translate(${x + cellW / 2 + 3}, ${startY - 10}) rotate(-90)">\n`;
      svg += `    <text font-size="10" font-weight="bold" fill="#1a202c">${escapeXml(e.tag)}</text>\n`;
      svg += `    <text font-size="8" fill="#4a5568" dx="0" dy="11">${escapeXml(e.action)} (L${e.esdLevel})</text>\n`;
      svg += `  </g>\n`;
    }

    // Grid cells & Cause Rows
    for (let i = 0; i < numCauses; i++) {
      const c = this.causes[i];
      const y = startY + i * cellH;
      const rowBg = i % 2 === 0 ? '#ffffff' : '#f7fafc';

      svg += `  <rect x="${margin}" y="${y}" width="${causeHeaderW + numEffects * cellW}" height="${cellH}" fill="${rowBg}" class="grid" />\n`;

      // Cause Label
      const setpointText = c.setpoint !== null ? `(${c.setpoint} ${c.unit})` : '';
      svg += `  <text x="${margin + 6}" y="${y + cellH / 2 + 4}" class="text-label" font-weight="bold">${escapeXml(c.tag)}</text>\n`;
      svg += `  <text x="${margin + 85}" y="${y + cellH / 2 + 4}" class="text-label">${escapeXml(c.voting)}</text>\n`;
      svg += `  <text x="${margin + 120}" y="${y + cellH / 2 + 4}" class="text-label" fill="#4a5568">${escapeXml(c.description.slice(0, 26))} ${escapeXml(setpointText)}</text>\n`;

      // Intersections
      for (let j = 0; j < numEffects; j++) {
        const e = this.effects[j];
        const x = startX + j * cellW;
        const link = this.getIntersection(c.id, e.id);

        if (link) {
          let badgeColor = '#e53e3e';
          if (link.actionCode === 'T') badgeColor = '#dd6b20';
          if (link.actionCode === 'R') badgeColor = '#3182ce';
          if (link.actionCode === 'A') badgeColor = '#d69e2e';

          svg += `  <circle cx="${x + cellW / 2}" cy="${y + cellH / 2}" r="9" fill="${badgeColor}" />\n`;
          svg += `  <text x="${x + cellW / 2}" y="${y + cellH / 2 + 4}" font-size="10" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(link.actionCode)}</text>\n`;
        }
      }
    }

    // Legend
    const legendY = startY + numCauses * cellH + 20;
    svg += `  <g transform="translate(${margin}, ${legendY})">\n`;
    svg += `    <text font-weight="bold" font-size="11" fill="#2d3748">Action Legend:</text>\n`;
    svg += `    <circle cx="95" cy="-4" r="7" fill="#e53e3e" /><text x="108" y="0" font-size="10">X: Immediate Trip</text>\n`;
    svg += `    <circle cx="225" cy="-4" r="7" fill="#dd6b20" /><text x="238" y="0" font-size="10">T: Timed Delay Trip</text>\n`;
    svg += `    <circle cx="365" cy="-4" r="7" fill="#3182ce" /><text x="378" y="0" font-size="10">R: Restart Inhibit</text>\n`;
    svg += `    <circle cx="495" cy="-4" r="7" fill="#d69e2e" /><text x="508" y="0" font-size="10">A: Alarm Only</text>\n`;
    svg += `    <text x="630" y="0" font-size="10" font-weight="bold" fill="#4a5568">ESD Levels: L0 (Abandonment), L1 (Train Trip), L2 (Unit Safe Hold), L3 (Equipment Trip)</text>\n`;
    svg += `  </g>\n`;

    svg += `</svg>\n`;
    return svg;
  }
}

module.exports = {
  ESD_LEVELS,
  CauseDefinition,
  EffectDefinition,
  CauseEffectMatrix
};
