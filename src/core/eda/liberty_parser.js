/**
 * OmniEng Liberty (.lib) parser — practical subset.
 *
 * Supported constructs:
 *   - library header with unit attributes (delay_model, time_unit,
 *     capacitance_unit, voltage_unit, current_unit, resistance_unit,
 *     leakage_power_unit) and cell groups
 *   - cell groups with `area` / `cell_leakage_power` attributes and pin groups
 *   - pin groups with `direction`, `capacitance`, `max_capacitance`,
 *     `min_capacitance` and timing groups
 *   - timing groups with `related_pin`, `timing_type`
 *     (rising_edge | falling_edge) and timing arcs
 *   - timing arcs cell_rise / cell_fall / rise_transition / fall_transition as
 *     either 2D lookup tables (index_1 / index_2 / values) or scalar constants
 *   - bilinear interpolation over 2D tables with linear extrapolation outside
 *     the table bounds (continuous; exact at table corners)
 *
 * Fail-closed policy: malformed or unsupported constructs raise Error rather
 * than being silently ignored or partially parsed.
 */

'use strict';

const LIB_ATTRIBUTES = new Set([
  'delay_model',
  'time_unit',
  'capacitance_unit',
  'voltage_unit',
  'current_unit',
  'resistance_unit',
  'leakage_power_unit'
]);

const CELL_ATTRIBUTES = new Set(['area', 'cell_leakage_power']);

const PIN_ATTRIBUTES = new Set(['direction', 'capacitance', 'max_capacitance', 'min_capacitance']);

const TIMING_ATTRIBUTES = new Set(['related_pin', 'timing_type']);

const TIMING_TYPES = new Set(['rising_edge', 'falling_edge']);

const ARC_KEYS = new Set(['cell_rise', 'cell_fall', 'rise_transition', 'fall_transition']);

const DIRECTIONS = new Set(['input', 'output', 'inout']);

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

function tokenize(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Liberty source must be a string.');
  }
  const tokens = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`Unterminated block comment at offset ${i}.`);
      i = end + 2;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < n && text[j] !== '"') {
        value += text[j];
        j++;
      }
      if (j >= n) throw new Error(`Unterminated string literal at offset ${i}.`);
      tokens.push({ type: 'string', value, pos: i });
      i = j + 1;
      continue;
    }
    if ('{}():;,'.includes(ch)) {
      tokens.push({ type: ch, value: ch, pos: i });
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || ((ch === '-' || ch === '+') && /[0-9]/.test(text[i + 1] || ''))) {
      let j = i;
      if (ch === '-' || ch === '+') j++;
      while (j < n && /[0-9]/.test(text[j])) j++;
      if (text[j] === '.') {
        j++;
        while (j < n && /[0-9]/.test(text[j])) j++;
      }
      if (text[j] === 'e' || text[j] === 'E') {
        let k = j + 1;
        if (text[k] === '+' || text[k] === '-') k++;
        if (/[0-9]/.test(text[k] || '')) {
          j = k;
          while (j < n && /[0-9]/.test(text[j])) j++;
        }
      }
      tokens.push({ type: 'number', value: Number(text.slice(i, j)), pos: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
      tokens.push({ type: 'ident', value: text.slice(i, j), pos: i });
      i = j;
      continue;
    }
    throw new Error(`Illegal character "${ch}" at offset ${i} in Liberty source.`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/**
 * 2D lookup table with bilinear interpolation (linear extrapolation outside
 * the index ranges).
 */
class LibertyTable {
  constructor(index1, index2, values) {
    this.index1 = Float64Array.from(index1);
    this.index2 = Float64Array.from(index2);
    this.values = Float64Array.from(values);
    const rows = index1.length;
    const cols = index2.length;
    if (rows < 2 || cols < 2) {
      throw new Error('Liberty lookup table requires at least 2x2 indices/values.');
    }
    for (let k = 1; k < rows; k++) {
      if (!(this.index1[k] > this.index1[k - 1])) {
        throw new Error('Liberty table index_1 must be strictly increasing.');
      }
    }
    for (let k = 1; k < cols; k++) {
      if (!(this.index2[k] > this.index2[k - 1])) {
        throw new Error('Liberty table index_2 must be strictly increasing.');
      }
    }
    if (this.values.length !== rows * cols) {
      throw new Error(
        `Liberty table value count ${this.values.length} does not match ` +
          `index_1 x index_2 dimensions (${rows} x ${cols} = ${rows * cols}).`
      );
    }
    this.rows = rows;
    this.cols = cols;
  }

  get(row, col) {
    return this.values[row * this.cols + col];
  }

  static lowerBound(arr, value) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  /**
   * Bilinear interpolation.  Exact at table corners; linear extrapolation
   * beyond the first/last index on each axis.
   * @param {number} x index_1 coordinate (e.g. input slew, ns)
   * @param {number} y index_2 coordinate (e.g. output load, pF)
   * @returns {number}
   */
  lookup(x, y) {
    const i = Math.min(Math.max(LibertyTable.lowerBound(this.index1, x), 0), this.rows - 2);
    const j = Math.min(Math.max(LibertyTable.lowerBound(this.index2, y), 0), this.cols - 2);
    const x0 = this.index1[i];
    const x1 = this.index1[i + 1];
    const y0 = this.index2[j];
    const y1 = this.index2[j + 1];
    const u = (x - x0) / (x1 - x0);
    const v = (y - y0) / (y1 - y0);
    const v00 = this.get(i, j);
    const v10 = this.get(i + 1, j);
    const v01 = this.get(i, j + 1);
    const v11 = this.get(i + 1, j + 1);
    return (1 - u) * (1 - v) * v00 + u * (1 - v) * v10 + (1 - u) * v * v01 + u * v * v11;
  }
}

class LibertyTiming {
  constructor() {
    this.relatedPin = null;
    this.timingType = null;
    this.arcs = {}; // { cellRise?: LibertyTable | number, ... }
  }

  getArc(key) {
    return this.arcs[key] !== undefined ? this.arcs[key] : null;
  }

  delay(slew, load, arcKey) {
    const arc = this.getArc(arcKey);
    if (arc === null) throw new Error(`Timing group has no arc "${arcKey}".`);
    if (arc instanceof LibertyTable) return arc.lookup(slew, load);
    return arc; // scalar constant
  }

  cellRiseDelay(slew, load) {
    return this.delay(slew, load, 'cellRise');
  }

  cellFallDelay(slew, load) {
    return this.delay(slew, load, 'cellFall');
  }

  riseTransitionDelay(slew, load) {
    return this.delay(slew, load, 'riseTransition');
  }

  fallTransitionDelay(slew, load) {
    return this.delay(slew, load, 'fallTransition');
  }
}

class LibertyPin {
  constructor(name) {
    this.name = name;
    this.direction = null;
    this.capacitance = null;
    this.maxCapacitance = null;
    this.minCapacitance = null;
    this.timings = [];
  }
}

class LibertyCell {
  constructor(name) {
    this.name = name;
    this.area = null;
    this.cellLeakagePower = null;
    this.pins = new Map();
  }

  addPin(pin) {
    if (this.pins.has(pin.name)) {
      throw new Error(`Duplicate pin "${pin.name}" in cell "${this.name}".`);
    }
    this.pins.set(pin.name, pin);
    return this;
  }
}

class LibertyLibrary {
  constructor(name) {
    this.name = name;
    this.units = {};
    this.cells = new Map();
    this.delayModel = null;
  }

  addCell(cell) {
    if (this.cells.has(cell.name)) {
      throw new Error(`Duplicate cell "${cell.name}" in library "${this.name}".`);
    }
    this.cells.set(cell.name, cell);
    return this;
  }

  getCell(name) {
    return this.cells.get(name) || null;
  }
}

// ---------------------------------------------------------------------------
// Parser (recursive descent over token stream)
// ---------------------------------------------------------------------------

class LibertyParser {
  constructor(text) {
    this.tokens = tokenize(text);
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset] || null;
  }

  next() {
    const tok = this.tokens[this.pos];
    if (!tok) throw new Error('Unexpected end of Liberty source.');
    this.pos++;
    return tok;
  }

  expect(type) {
    const tok = this.next();
    if (tok.type !== type) {
      throw new Error(`Expected "${type}" at offset ${tok.pos}, found "${tok.value}".`);
    }
    return tok;
  }

  atEnd() {
    return this.pos >= this.tokens.length;
  }

  parse() {
    const first = this.peek();
    if (!first) throw new Error('Empty Liberty source.');
    if (first.type !== 'ident' || first.value !== 'library') {
      throw new Error('Liberty source must begin with a library declaration.');
    }
    this.next();
    this.expect('(');
    const nameTok = this.expect('ident');
    const name = nameTok.value;
    this.expect(')');
    this.expect('{');
    const lib = new LibertyLibrary(name);
    const seenKeys = new Set();
    while (!this.atEnd()) {
      const tok = this.peek();
      if (tok.type === '}') {
        this.next();
        return lib;
      }
      if (tok.type === 'ident' && tok.value === 'cell') {
        lib.addCell(this.parseCell());
        continue;
      }
      this.parseAttribute(seenKeys, LIB_ATTRIBUTES, (key, value) => {
        if (key === 'delay_model') lib.delayModel = value;
        else lib.units[key] = value;
      });
    }
    throw new Error('Unterminated library block (missing "}").');
  }

  parseAttribute(seenKeys, allowedKeys, onParse) {
    const keyTok = this.peek();
    if (!keyTok || keyTok.type !== 'ident') {
      throw new Error(`Expected attribute name at offset ${keyTok ? keyTok.pos : 'EOF'}.`);
    }
    const key = keyTok.value;
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported construct "${key}" at offset ${keyTok.pos}.`);
    }
    this.next();
    this.expect(':');
    const valueTok = this.next();
    let value;
    if (valueTok.type === 'string' || valueTok.type === 'number') {
      value = valueTok.value;
    } else if (valueTok.type === 'ident') {
      value = valueTok.value;
    } else {
      throw new Error(`Invalid value for attribute "${key}" at offset ${valueTok.pos}.`);
    }
    if (key === 'direction' && !DIRECTIONS.has(value)) {
      throw new Error(`Unsupported pin direction "${value}" at offset ${valueTok.pos}.`);
    }
    if (key === 'timing_type' && !TIMING_TYPES.has(value)) {
      throw new Error(`Unsupported timing_type "${value}" at offset ${valueTok.pos}.`);
    }
    this.expect(';');
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate attribute "${key}".`);
    }
    seenKeys.add(key);
    onParse(key, value);
    return value;
  }

  parseCell() {
    this.next(); // 'cell'
    this.expect('(');
    const nameTok = this.expect('ident');
    const cell = new LibertyCell(nameTok.value);
    this.expect(')');
    this.expect('{');
    const seenKeys = new Set();
    while (!this.atEnd()) {
      const tok = this.peek();
      if (tok.type === '}') {
        this.next();
        return cell;
      }
      if (tok.type === 'ident' && tok.value === 'pin') {
        cell.addPin(this.parsePin());
        continue;
      }
      this.parseAttribute(seenKeys, CELL_ATTRIBUTES, (key, value) => {
        if (key === 'area') cell.area = value;
        else cell.cellLeakagePower = value;
      });
    }
    throw new Error(`Unterminated cell block "${cell.name}".`);
  }

  parsePin() {
    this.next(); // 'pin'
    this.expect('(');
    const nameTok = this.expect('ident');
    const pin = new LibertyPin(nameTok.value);
    this.expect(')');
    this.expect('{');
    const seenKeys = new Set();
    while (!this.atEnd()) {
      const tok = this.peek();
      if (tok.type === '}') {
        this.next();
        if (!pin.direction) {
          throw new Error(`Pin "${pin.name}" is missing required "direction" attribute.`);
        }
        return pin;
      }
      if (tok.type === 'ident' && tok.value === 'timing') {
        pin.timings.push(this.parseTiming());
        continue;
      }
      this.parseAttribute(seenKeys, PIN_ATTRIBUTES, (key, value) => {
        if (key === 'direction') pin.direction = value;
        else if (key === 'capacitance') pin.capacitance = value;
        else if (key === 'max_capacitance') pin.maxCapacitance = value;
        else pin.minCapacitance = value;
      });
    }
    throw new Error(`Unterminated pin block "${pin.name}".`);
  }

  parseTiming() {
    this.next(); // 'timing'
    this.expect('(');
    this.expect(')');
    this.expect('{');
    const timing = new LibertyTiming();
    const seenKeys = new Set();
    while (!this.atEnd()) {
      const tok = this.peek();
      if (tok.type === '}') {
        this.next();
        if (!timing.relatedPin) {
          throw new Error('Timing group is missing required "related_pin" attribute.');
        }
        if (!timing.timingType) {
          throw new Error('Timing group is missing required "timing_type" attribute.');
        }
        return timing;
      }
      if (tok.type === 'ident' && ARC_KEYS.has(tok.value)) {
        const arcKey = tok.value;
        this.next();
        const arc = this.parseArc();
        const parts = arcKey.split('_');
        const normalizedKey =
          parts[0].toLowerCase() +
          parts
            .slice(1)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');
        if (timing.arcs[normalizedKey] !== undefined) {
          throw new Error(`Duplicate timing arc "${arcKey}" in timing group.`);
        }
        timing.arcs[normalizedKey] = arc;
        continue;
      }
      this.parseAttribute(seenKeys, TIMING_ATTRIBUTES, (key, value) => {
        if (key === 'related_pin') timing.relatedPin = value;
        else timing.timingType = value;
      });
    }
    throw new Error('Unterminated timing group.');
  }

  parseArc() {
    this.expect('(');
    const first = this.peek();
    if (first.type === 'number') {
      // scalar arc: cell_rise (0.05);
      const valueTok = this.next();
      const value = valueTok.value;
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid scalar arc value at offset ${valueTok.pos}.`);
      }
      this.expect(')');
      this.expect(';');
      return value;
    }
    if (first.type === 'ident') {
      // template name is accepted but not interpreted: cell_rise (template) { ... }
      this.next();
      this.expect(')');
      this.expect('{');
      let index1 = null;
      let index2 = null;
      let values = null;
      let valueRows = [];
      while (!this.atEnd()) {
        const tok = this.peek();
        if (tok.type === '}') {
          this.next();
          if (index1 === null || index2 === null || values === null) {
            throw new Error('Timing arc table must define index_1, index_2, and values.');
          }
          return new LibertyTable(index1, index2, values);
        }
        if (tok.type === 'ident' && (tok.value === 'index_1' || tok.value === 'index_2' || tok.value === 'values')) {
          const kind = tok.value;
          this.next();
          this.expect('(');
          if (kind === 'values') {
            valueRows = [];
            while (true) {
              const inner = this.peek();
              if (inner.type === 'string') {
                this.next();
                valueRows.push(parseNumberList(inner.value, inner.pos));
                const after = this.peek();
                if (after && after.type === ',') {
                  this.next();
                  continue;
                }
                break;
              }
              if (inner.type === 'number') {
                const row = [];
                while (true) {
                  const numTok = this.peek();
                  if (!numTok || numTok.type !== 'number') {
                    throw new Error(`Expected value number at offset ${numTok ? numTok.pos : 'EOF'}.`);
                  }
                  row.push(numTok.value);
                  this.next();
                  const sep = this.peek();
                  if (sep && sep.type === ',') {
                    this.next();
                    continue;
                  }
                  break;
                }
                valueRows.push(row);
                break;
              }
              throw new Error(`Expected string or number list in values() at offset ${inner.pos}.`);
            }
            this.expect(')');
            this.expect(';');
            const flat = [];
            for (const row of valueRows) flat.push(...row);
            values = flat;
            continue;
          }
          if (kind === 'index_1') {
            index1 = this.parseIndexList();
          } else {
            index2 = this.parseIndexList();
          }
          continue;
        }
        throw new Error(`Unsupported construct "${tok.value}" inside timing arc table at offset ${tok.pos}.`);
      }
      throw new Error('Unterminated timing arc table.');
    }
    throw new Error(`Expected scalar or table timing arc at offset ${first ? first.pos : 'EOF'}.`);
  }

  parseIndexList() {
    const inner = this.peek();
    let list;
    if (inner.type === 'string') {
      this.next();
      list = parseNumberList(inner.value, inner.pos);
    } else {
      list = [];
      while (true) {
        const numTok = this.peek();
        if (!numTok || numTok.type !== 'number') {
          throw new Error(`Expected index number at offset ${numTok ? numTok.pos : 'EOF'}.`);
        }
        list.push(numTok.value);
        this.next();
        const sep = this.peek();
        if (sep && sep.type === ',') {
          this.next();
          continue;
        }
        break;
      }
    }
    this.expect(')');
    this.expect(';');
    return list;
  }
}

function parseNumberList(text, pos) {
  const parts = text.split(',');
  const out = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      throw new Error(`Empty number in list at offset ${pos}.`);
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid number "${trimmed}" in list at offset ${pos}.`);
    }
    out.push(value);
  }
  return out;
}

/**
 * Parse a Liberty (.lib) source string into a LibertyLibrary.
 * @param {string} text
 * @returns {LibertyLibrary}
 * @throws {Error} fail closed on malformed/unsupported constructs
 */
function parseLiberty(text) {
  return new LibertyParser(text).parse();
}

module.exports = {
  parseLiberty,
  LibertyLibrary,
  LibertyCell,
  LibertyPin,
  LibertyTiming,
  LibertyTable
};
