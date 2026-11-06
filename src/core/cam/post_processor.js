'use strict';

/**
 * OmniEng CAM Post-Processor Engine.
 *
 * Emits ISO 6983 G-code from a neutral toolpath (rapid G00, linear G01,
 * circular G02/G03, canned cycle G81, M-codes, and F/S/T words) with
 * controller-specific dialect handling:
 *
 *  - Fanuc 30i/31i      -> G43.4 H<n> RTCP activation
 *  - Siemens Sinumerik   -> TRAORI RTCP activation
 *    840D sl
 *  - Heidenhain TNC 640 -> M128 RTCP activation
 *
 * Output guarantees:
 *  - N### sequence numbers strictly increasing by 1..10 (default step 10)
 *  - no modal command duplication (the same G-code is never repeated
 *    consecutively in its group; F is likewise modal and suppressed when
 *    unchanged)
 *  - X/Y/Z coordinates formatted with a minimum of 3 decimals; other
 *    numeric words (F, R, ...) have trailing zeros trimmed
 *  - dependency-free, deterministic, strict ISO 6983 block grammar:
 *    `N<digits> <words>` where each word is `[A-Z][+-]?<number>` or an
 *    alpha keyword (e.g. TRAORI) or M/T/S/F followed by an integer.
 */

const DIALECTS = Object.freeze({
  FANUC: 'fanuc',
  SIEMENS: 'siemens',
  HEIDENHAIN: 'heidenhain'
});

const G_GROUPS = Object.freeze({
  G00: 'motion',
  G01: 'motion',
  G02: 'motion',
  G03: 'motion',
  G81: 'motion',
  G90: 'distance',
  G91: 'distance',
  G94: 'feedmode',
  G95: 'feedmode',
  G17: 'plane',
  G18: 'plane',
  G19: 'plane',
  G40: 'comp',
  G41: 'comp',
  G42: 'comp',
  G49: 'len',
  G80: 'cyclecancel',
  G21: 'unit',
  G20: 'unit',
  G54: 'workoffset',
  G55: 'workoffset',
  G56: 'workoffset',
  G57: 'workoffset',
  G58: 'workoffset',
  G59: 'workoffset',
  'G43.4': 'rtcp'
});

class PostProcessor {
  /**
   * @param {Object} [options]
   * @param {string} [options.dialect='fanuc'] 'fanuc' | 'siemens' | 'heidenhain'
   * @param {number} [options.toolNumber=1]
   * @param {number} [options.spindleRpm=12000]
   * @param {number} [options.feedRateMmMin=1500]
   * @param {number} [options.sequenceStart=1] first N sequence number, >= 1
   * @param {number} [options.sequenceIncrement=10] step, 1..10
   * @param {string} [options.arcStyle] 'IJ' (default for Fanuc/Siemens) or
   *   'R' (default for Heidenhain)
   * @param {string} [options.heidenhainRtcp='M128'] M128 (FUNCTION TCPM is
   *   not representable in the strict ISO 6983 word grammar)
   */
  constructor(options = {}) {
    const opts = options || {};
    const dialect = opts.dialect || DIALECTS.FANUC;
    if (!Object.values(DIALECTS).includes(dialect)) {
      throw new TypeError(`PostProcessor dialect must be one of ${Object.values(DIALECTS).join(', ')}`);
    }

    const toolNumber = opts.toolNumber ?? 1;
    const spindleRpm = opts.spindleRpm ?? 12000;
    const feedRateMmMin = opts.feedRateMmMin ?? 1500;
    if (!Number.isInteger(toolNumber) || toolNumber < 1) {
      throw new TypeError('PostProcessor toolNumber must be a positive integer');
    }
    if (!Number.isFinite(spindleRpm) || spindleRpm <= 0) {
      throw new TypeError('PostProcessor spindleRpm must be finite and positive');
    }
    if (!Number.isFinite(feedRateMmMin) || feedRateMmMin <= 0) {
      throw new TypeError('PostProcessor feedRateMmMin must be finite and positive');
    }

    const sequenceStart = opts.sequenceStart ?? 1;
    const sequenceIncrement = opts.sequenceIncrement ?? 10;
    if (!Number.isInteger(sequenceStart) || sequenceStart < 1) {
      throw new TypeError('PostProcessor sequenceStart must be an integer >= 1');
    }
    if (!Number.isInteger(sequenceIncrement) || sequenceIncrement < 1 || sequenceIncrement > 10) {
      throw new TypeError('PostProcessor sequenceIncrement must be an integer in 1..10');
    }

    const arcStyle = opts.arcStyle ?? (dialect === DIALECTS.HEIDENHAIN ? 'R' : 'IJ');
    if (!['IJ', 'R'].includes(arcStyle)) {
      throw new TypeError('PostProcessor arcStyle must be "IJ" or "R"');
    }

    if (dialect === DIALECTS.HEIDENHAIN) {
      const rtcp = opts.heidenhainRtcp ?? 'M128';
      if (rtcp !== 'M128') {
        throw new TypeError(
          'Heidenhain RTCP must be "M128"; FUNCTION TCPM is not expressible in the strict ISO 6983 word grammar'
        );
      }
    }

    this.dialect = dialect;
    this.toolNumber = toolNumber;
    this.spindleRpm = spindleRpm;
    this.feedRateMmMin = feedRateMmMin;
    this.arcStyle = arcStyle;
    this.sequenceStart = sequenceStart;
    this.sequenceIncrement = sequenceIncrement;
  }

  _axis(value) {
    return value.toFixed(3);
  }

  _num(value) {
    return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  reset() {
    this._seq = this.sequenceStart;
    this._modal = new Map();
    this._lastFeed = null;
    return this;
  }

  _next() {
    const n = this._seq;
    this._seq += this.sequenceIncrement;
    return n;
  }

  _block(words) {
    return 'N' + this._next() + ' ' + words.join(' ');
  }

  _g(code) {
    const group = G_GROUPS[code];
    if (group === undefined) {
      throw new TypeError(`Unsupported G-code word: ${code}`);
    }
    if (this._modal.get(group) === code) {
      return null;
    }
    this._modal.set(group, code);
    return code;
  }

  _feed(feed) {
    if (feed === undefined || feed === null) {
      return null;
    }
    if (this._lastFeed === feed) {
      return null;
    }
    this._lastFeed = feed;
    return 'F' + this._num(feed);
  }

  _axisWords(point) {
    const words = [];
    if (point.x !== undefined) words.push('X' + this._axis(point.x));
    if (point.y !== undefined) words.push('Y' + this._axis(point.y));
    if (point.z !== undefined) words.push('Z' + this._axis(point.z));
    return words;
  }

  _arcWords(item) {
    if (this.arcStyle === 'R') {
      const r = item.r !== undefined ? item.r : Math.hypot(item.i || 0, item.j || 0);
      return ['R' + this._num(r)];
    }
    const words = [];
    if (item.i !== undefined) words.push('I' + this._axis(item.i));
    if (item.j !== undefined) words.push('J' + this._axis(item.j));
    if (item.k !== undefined) words.push('K' + this._axis(item.k));
    return words;
  }

  /**
   * Post-process a neutral toolpath into ISO 6983 G-code lines.
   *
   * @param {Array<Object>} toolpath Neutral move sequence:
   *   { type: 'rapid', x, y, z }
   *   { type: 'linear', x, y, z, feed? }
   *   { type: 'arc', x, y, z, i?, j?, k?, r?, dir: 'cw'|'ccw', feed? }
   *   { type: 'cycle', code: 'G81', x, y, z, r, feed? }
   *   { type: 'toolchange', tool }
   *   { type: 'spindle', rpm, direction: 'cw'|'ccw' }
   *   { type: 'mcode', code: 'M08' }
   * @returns {string[]} G-code lines (each strictly `N<digits> <words>`)
   */
  postProcess(toolpath) {
    if (!Array.isArray(toolpath)) {
      throw new TypeError('PostProcessor.postProcess requires an array toolpath');
    }
    this.reset();

    const lines = [];

    lines.push(this._block(['G90', 'G94', 'G17', 'G40', 'G49', 'G80'].map((g) => this._g(g)).filter(Boolean)));
    lines.push(this._block([this._g('G21')]));
    lines.push(this._block([this._g('G54')]));

    lines.push(this._block([`T${this.toolNumber}`, 'M06']));
    lines.push(this._block([`S${Math.round(this.spindleRpm)}`, 'M03']));

    if (this.dialect === DIALECTS.FANUC) {
      lines.push(this._block([this._g('G43.4'), `H${this.toolNumber}`]));
    } else if (this.dialect === DIALECTS.SIEMENS) {
      lines.push(this._block(['TRAORI']));
    } else {
      lines.push(this._block(['M128']));
    }
    lines.push(this._block(['M08']));

    for (const item of toolpath) {
      if (!item || typeof item !== 'object') {
        throw new TypeError('PostProcessor toolpath items must be objects');
      }
      const type = item.type;
      if (type === 'rapid' || type === 'linear') {
        const g = type === 'rapid' ? 'G00' : 'G01';
        const words = [];
        const emitted = this._g(g);
        if (emitted) words.push(emitted);
        words.push(...this._axisWords(item));
        const feed = this._feed(item.feed);
        if (feed) words.push(feed);
        lines.push(this._block(words));
      } else if (type === 'arc') {
        const g = item.dir === 'cw' ? 'G02' : 'G03';
        const words = [];
        const emitted = this._g(g);
        if (emitted) words.push(emitted);
        words.push(...this._axisWords(item));
        words.push(...this._arcWords(item));
        const feed = this._feed(item.feed);
        if (feed) words.push(feed);
        lines.push(this._block(words));
      } else if (type === 'cycle') {
        const words = [];
        const emitted = this._g(item.code || 'G81');
        if (emitted) words.push(emitted);
        words.push(...this._axisWords(item));
        if (item.r !== undefined) words.push('R' + this._axis(item.r));
        const feed = this._feed(item.feed);
        if (feed) words.push(feed);
        lines.push(this._block(words));
      } else if (type === 'toolchange') {
        if (!Number.isInteger(item.tool) || item.tool < 1) {
          throw new TypeError('PostProcessor toolchange requires a positive integer tool');
        }
        lines.push(this._block([`T${item.tool}`, 'M06']));
      } else if (type === 'spindle') {
        if (!Number.isFinite(item.rpm) || item.rpm <= 0) {
          throw new TypeError('PostProcessor spindle requires positive rpm');
        }
        const m = item.direction === 'ccw' ? 'M04' : 'M03';
        lines.push(this._block([`S${Math.round(item.rpm)}`, m]));
      } else if (type === 'mcode') {
        if (typeof item.code !== 'string' || !/^M\d+$/.test(item.code)) {
          throw new TypeError('PostProcessor mcode requires an M-coded string');
        }
        lines.push(this._block([item.code]));
      } else {
        throw new TypeError(`Unsupported toolpath item type: ${type}`);
      }
    }

    lines.push(this._block(['M09']));
    lines.push(this._block(['M05']));
    lines.push(this._block(['M30']));

    return lines;
  }

  /**
   * Convenience: post-process and join into a single G-code text document.
   */
  generate(toolpath) {
    return this.postProcess(toolpath).join('\n');
  }
}

module.exports = {
  PostProcessor,
  DIALECTS
};
