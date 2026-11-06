/**
 * Real FMI 2.0 package reader for OmniEng co-simulation.
 *
 * Implements:
 *  - A minimal ZIP central-directory reader in pure JS (EOCD + central
 *    directory + local file headers), with stored and deflate entries
 *    (Node zlib.inflateRawSync) and CRC32 integrity verification.
 *  - A strict SAX-style tokenizer for modelDescription.xml producing a typed
 *    FMI model description (ScalarVariables, StartValues, ModelStructure).
 *  - An FMU execution host that instantiates continuous-time states from the
 *    parsed variable list and integrates them with the real ODE solvers in
 *    ../math/ode_solvers.js via a per-variable derivative callback map.
 *
 * Native dlopen of FMU shared libraries is intentionally NOT implemented at
 * this stage; in-JS equation callbacks are the execution substrate.
 */

'use strict';

const zlib = require('zlib');
const { ODESolvers } = require('../math/ode_solvers');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function readU16(buf, off) {
  return buf.readUInt16LE(off);
}

function readU32(buf, off) {
  return buf.readUInt32LE(off);
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  throw new TypeError('FmuReader expects a Buffer, Uint8Array, ArrayBuffer, or string');
}

class FmuError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FmuError';
    this.code = code;
  }
}

class ZipFormatError extends FmuError {
  constructor(message) {
    super('ZIP_FORMAT', message);
    this.name = 'ZipFormatError';
  }
}

class ModelDescriptionError extends FmuError {
  constructor(message) {
    super('MODEL_DESCRIPTION_INVALID', message);
    this.name = 'ModelDescriptionError';
  }
}

class FmuExecutionError extends FmuError {
  constructor(message) {
    super('FMU_EXECUTION', message);
    this.name = 'FmuExecutionError';
  }
}

function toNumber(raw, what) {
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new ModelDescriptionError(`non-numeric ${what}: "${raw}"`);
  return v;
}

function toInt(raw, what) {
  const v = Number(raw);
  if (!Number.isInteger(v)) throw new ModelDescriptionError(`non-integer ${what}: "${raw}"`);
  return v;
}

function toBool(raw) {
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ModelDescriptionError(`invalid boolean value "${raw}"`);
}

const TYPE_KINDS = new Set(['Real', 'Integer', 'Boolean', 'String', 'Enumeration']);

const MAX_ZIP_ENTRIES = 4096;
const MAX_ZIP_ENTRY_NAME_CHARS = 1024;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_MODEL_DESCRIPTION_XML_CHARS = 8 * 1024 * 1024;
const MAX_SIM_SPAN = 1e6;
const MAX_SIM_STEPS = 5e6;
const MIN_RK4_DT = 1e-9;

function parseScalarVariable(el) {
  const name = el.attrs.name;
  if (!name) throw new ModelDescriptionError('ScalarVariable missing name attribute');
  if (el.children.length !== 1 || !TYPE_KINDS.has(el.children[0].tag)) {
    throw new ModelDescriptionError(
      `ScalarVariable "${name}" must contain exactly one type element (Real/Integer/Boolean/String/Enumeration)`
    );
  }
  const typeEl = el.children[0];
  const kind = typeEl.tag;
  const parsedType = { kind };
  let start;
  if (typeEl.attrs.start !== undefined) {
    if (kind === 'Real') start = toNumber(typeEl.attrs.start, `${name}.start`);
    else if (kind === 'Integer' || kind === 'Enumeration') start = toInt(typeEl.attrs.start, `${name}.start`);
    else if (kind === 'Boolean') start = toBool(typeEl.attrs.start);
    else if (kind === 'String') start = typeEl.attrs.start;
    parsedType.start = start;
  }
  if (typeEl.attrs.min !== undefined) {
    parsedType.min =
      kind === 'Real' ? toNumber(typeEl.attrs.min, `${name}.min`) : toInt(typeEl.attrs.min, `${name}.min`);
  }
  if (typeEl.attrs.max !== undefined) {
    parsedType.max =
      kind === 'Real' ? toNumber(typeEl.attrs.max, `${name}.max`) : toInt(typeEl.attrs.max, `${name}.max`);
  }
  if (typeEl.attrs.nominal !== undefined) {
    parsedType.nominal = toNumber(typeEl.attrs.nominal, `${name}.nominal`);
  }
  if (typeEl.attrs.unit !== undefined) parsedType.unit = typeEl.attrs.unit;
  if (typeEl.attrs.displayUnit !== undefined) parsedType.displayUnit = typeEl.attrs.displayUnit;
  if (typeEl.attrs.fixed !== undefined) parsedType.fixed = toBool(typeEl.attrs.fixed);
  if (typeEl.attrs.quantity !== undefined) parsedType.quantity = typeEl.attrs.quantity;
  return {
    name,
    valueReference: toInt(el.attrs.valueReference ?? '0', `${name}.valueReference`),
    causality: el.attrs.causality || 'local',
    variability: el.attrs.variability || 'continuous',
    initial: el.attrs.initial,
    description: el.attrs.description,
    type: parsedType
  };
}

function parseUnknown(el) {
  const name = el.attrs.name;
  if (!name) throw new ModelDescriptionError('ModelStructure Unknown missing name attribute');
  const unknown = {
    name,
    index: toInt(el.attrs.index ?? '0', `${name}.index`)
  };
  if (el.attrs.dependencies !== undefined) {
    unknown.dependencies = el.attrs.dependencies.split(' ').filter(Boolean);
  }
  if (el.attrs.dependenciesKind !== undefined) {
    unknown.dependenciesKind = el.attrs.dependenciesKind.split(' ').filter(Boolean);
  }
  return unknown;
}

function parseXml(xml) {
  if (typeof xml !== 'string') throw new ModelDescriptionError('XML content must be a string');
  if (xml.length > MAX_MODEL_DESCRIPTION_XML_CHARS) {
    throw new ModelDescriptionError(
      `XML content exceeds the ${MAX_MODEL_DESCRIPTION_XML_CHARS}-character limit`
    );
  }
  if (xml.charCodeAt(0) === 0xfeff) xml = xml.slice(1);
  const stack = [];
  let root = null;
  let i = 0;
  const n = xml.length;
  const fail = (msg) => {
    throw new ModelDescriptionError(`${msg} at offset ${i}`);
  };
  const decodeEntities = (s, ctx) => {
    if (/&(?!(?:#x?[0-9a-fA-F]+|[A-Za-z]+);)/.test(s)) fail(`unescaped ampersand in ${ctx}`);
    return s.replace(/&(#x?[0-9a-fA-F]+|[A-Za-z]+);/g, (m, ent) => {
      if (ent[0] === '#') {
        const hex = ent[1] === 'x' || ent[1] === 'X';
        const digits = hex ? ent.slice(2) : ent.slice(1);
        const cp = parseInt(digits, hex ? 16 : 10);
        if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
          fail(`invalid character reference ${m}`);
        }
        return String.fromCodePoint(cp);
      }
      switch (ent) {
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'amp':
          return '&';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          fail(`unknown entity &${ent};`);
      }
    });
  };
  const findTagEnd = (start) => {
    let j = start;
    let quote = null;
    while (j < n) {
      const ch = xml[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        return j;
      } else if (ch === '<') {
        fail('unexpected "<" inside tag');
      }
      j++;
    }
    fail('unterminated tag');
  };
  const parseStartTag = (inner) => {
    const selfClosing = /\/\s*$/.test(inner);
    const content = selfClosing ? inner.replace(/\/\s*$/, '') : inner;
    const m = /^([^\s/>]+)/.exec(content);
    if (!m || !/^[A-Za-z_][\w:.-]*$/.test(m[1])) fail('invalid tag name');
    const tag = m[1];
    const rest = content.slice(m[0].length);
    const attrs = {};
    const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let mm;
    while ((mm = attrRe.exec(rest))) {
      const attrName = mm[1];
      if (Object.prototype.hasOwnProperty.call(attrs, attrName)) fail(`duplicate attribute "${attrName}"`);
      attrs[attrName] = decodeEntities(mm[2] !== undefined ? mm[2] : mm[3], `attribute "${attrName}"`);
    }
    if (rest.replace(attrRe, '').trim()) fail(`malformed attribute syntax near "${rest.trim()}"`);
    return { tag, attrs, selfClosing };
  };
  while (i < n) {
    if (xml[i] !== '<') {
      const end = xml.indexOf('<', i);
      const seg = end === -1 ? xml.slice(i) : xml.slice(i, end);
      if (seg) {
        const dec = decodeEntities(seg, 'text');
        if (stack.length) stack[stack.length - 1].text += dec;
        else if (dec.trim()) fail('text outside root element');
      }
      if (end === -1) break;
      i = end;
    }
    if (xml.startsWith('<!--', i)) {
      const e = xml.indexOf('-->', i + 4);
      if (e === -1) fail('unterminated comment');
      i = e + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const e = xml.indexOf(']]>', i + 9);
      if (e === -1) fail('unterminated CDATA section');
      if (stack.length) stack[stack.length - 1].text += xml.slice(i + 9, e);
      i = e + 3;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const e = xml.indexOf('?>', i + 2);
      if (e === -1) fail('unterminated processing instruction');
      i = e + 2;
      continue;
    }
    if (xml.startsWith('<!', i)) {
      const e = xml.indexOf('>', i + 2);
      if (e === -1) fail('unterminated declaration');
      i = e + 1;
      continue;
    }
    const gt = findTagEnd(i + 1);
    const inner = xml.slice(i + 1, gt);
    if (inner[0] === '/') {
      const closeName = inner.slice(1).trim();
      if (!stack.length) fail(`unexpected closing tag </${closeName}>`);
      const top = stack[stack.length - 1];
      if (top.tag !== closeName) fail(`mismatched closing tag </${closeName}> expected </${top.tag}>`);
      stack.pop();
      i = gt + 1;
      continue;
    }
    const { tag, attrs, selfClosing } = parseStartTag(inner);
    const node = { tag, attrs, children: [], text: '' };
    if (!stack.length) {
      if (root) fail('multiple root elements');
      root = node;
    } else {
      stack[stack.length - 1].children.push(node);
    }
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }
  if (stack.length) fail(`unclosed element <${stack[stack.length - 1].tag}>`);
  if (!root) fail('no root element found');
  return root;
}

function parseModelDescription(xmlText) {
  const root = parseXml(xmlText);
  if (root.tag !== 'fmiModelDescription') {
    throw new ModelDescriptionError(`root element must be <fmiModelDescription>, got <${root.tag}>`);
  }
  const fmiVersion = root.attrs.fmiVersion;
  if (!fmiVersion) throw new ModelDescriptionError('fmiModelDescription missing fmiVersion attribute');
  if (fmiVersion !== '2.0' && fmiVersion !== '3.0') {
    throw new ModelDescriptionError(`unsupported fmiVersion "${fmiVersion}" (expected 2.0 or 3.0)`);
  }
  const model = {
    fmiVersion,
    modelName: root.attrs.modelName || '',
    guid: root.attrs.guid || '',
    generationTool: root.attrs.generationTool || '',
    generationDateAndTime: root.attrs.generationDateAndTime || '',
    variableNamingConvention: root.attrs.variableNamingConvention || 'flat',
    description: root.attrs.description || '',
    numberOfContinuousStates:
      root.attrs.numberOfContinuousStates !== undefined
        ? toInt(root.attrs.numberOfContinuousStates, 'numberOfContinuousStates')
        : 0,
    rootAttributes: { ...root.attrs },
    capabilities: {},
    variables: [],
    startValues: new Map(),
    modelStructure: { outputs: [], derivatives: [], initialUnknowns: [] }
  };
  for (const child of root.children) {
    if (child.tag === 'CoSimulation' || child.tag === 'ModelExchange') {
      model.capabilities[child.tag] = { ...child.attrs };
    } else if (child.tag === 'ModelVariables') {
      for (const sv of child.children) {
        if (sv.tag !== 'ScalarVariable') continue;
        const v = parseScalarVariable(sv);
        model.variables.push(v);
        if (v.type.start !== undefined) model.startValues.set(v.name, v.type.start);
      }
    } else if (child.tag === 'ModelStructure') {
      for (const sec of child.children) {
        const unknowns = sec.children.filter((c) => c.tag === 'Unknown').map(parseUnknown);
        if (sec.tag === 'Outputs') model.modelStructure.outputs = unknowns;
        else if (sec.tag === 'Derivatives') model.modelStructure.derivatives = unknowns;
        else if (sec.tag === 'InitialUnknowns') model.modelStructure.initialUnknowns = unknowns;
      }
    }
  }
  if (!model.variables.length) {
    throw new ModelDescriptionError('ModelVariables must declare at least one ScalarVariable');
  }
  return model;
}

class FmuReader {
  readZip(input) {
    const buf = toBuffer(input);
    const eocd = this._findEocd(buf);
    const totalEntries = readU16(buf, eocd + 10);
    const cdSize = readU32(buf, eocd + 12);
    const cdOffset = readU32(buf, eocd + 16);
    if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new ZipFormatError('zip64 archives are not supported');
    }
    if (readU16(buf, eocd + 4) !== 0 || readU16(buf, eocd + 6) !== 0) {
      throw new ZipFormatError('multi-disk archives are not supported');
    }
    if (readU16(buf, eocd + 8) !== totalEntries) {
      throw new ZipFormatError('split disk entry count mismatch');
    }
    if (cdOffset + cdSize > eocd)
      throw new ZipFormatError('central directory extends past end-of-central-directory record');
    if (totalEntries > MAX_ZIP_ENTRIES) {
      throw new ZipFormatError(`archive entry count ${totalEntries} exceeds the ${MAX_ZIP_ENTRIES} limit`);
    }
    const commentLen = readU16(buf, eocd + 20);
    const comment = buf.slice(eocd + 22, eocd + 22 + commentLen).toString('utf8');
    const entries = new Map();
    let p = cdOffset;
    let totalUncompressed = 0;
    for (let k = 0; k < totalEntries; k++) {
      if (p + 46 > buf.length || readU32(buf, p) !== 0x02014b50) {
        throw new ZipFormatError(`invalid central directory entry ${k}`);
      }
      const flags = readU16(buf, p + 8);
      const method = readU16(buf, p + 10);
      const crc = readU32(buf, p + 16);
      const compSize = readU32(buf, p + 20);
      const uncompSize = readU32(buf, p + 24);
      const nameLen = readU16(buf, p + 28);
      const extraLen = readU16(buf, p + 30);
      const commentLen2 = readU16(buf, p + 32);
      const localOff = readU32(buf, p + 42);
      const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
      p += 46 + nameLen + extraLen + commentLen2;
      if (nameLen > MAX_ZIP_ENTRY_NAME_CHARS) {
        throw new ZipFormatError(`entry name exceeds the ${MAX_ZIP_ENTRY_NAME_CHARS}-character limit`);
      }
      if (uncompSize > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) {
        throw new ZipFormatError(
          `entry "${name}" uncompressed size exceeds the ${MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES}-byte limit`
        );
      }
      totalUncompressed += uncompSize;
      if (totalUncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        throw new ZipFormatError(
          `archive total uncompressed size exceeds the ${MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES}-byte limit`
        );
      }
      const data = this._extractEntry(buf, { name, localOff, flags, method, crc, compSize, uncompSize });
      entries.set(name, {
        name,
        method,
        flags,
        crc32: crc,
        compressedSize: compSize,
        uncompressedSize: uncompSize,
        data
      });
    }
    return { entries, entryCount: totalEntries, comment };
  }

  _findEocd(buf) {
    const min = Math.max(0, buf.length - 65557);
    for (let i = buf.length - 22; i >= min; i--) {
      if (readU32(buf, i) === 0x06054b50) return i;
    }
    throw new ZipFormatError('end-of-central-directory record not found (not a zip archive)');
  }

  _extractEntry(buf, entry) {
    const { name, localOff, method, crc } = entry;
    if (localOff + 30 > buf.length || readU32(buf, localOff) !== 0x04034b50) {
      throw new ZipFormatError(`entry "${name}" missing local file header`);
    }
    const nameLen = readU16(buf, localOff + 26);
    const extraLen = readU16(buf, localOff + 28);
    const dataStart = localOff + 30 + nameLen + extraLen;
    if (dataStart + entry.compSize > buf.length) {
      throw new ZipFormatError(`entry "${name}" data out of bounds`);
    }
    let data = buf.slice(dataStart, dataStart + entry.compSize);
    if (method === 0) {
      if (entry.compSize !== entry.uncompSize) {
        throw new ZipFormatError(`stored entry "${name}" size mismatch`);
      }
    } else if (method === 8) {
      try {
        data = zlib.inflateRawSync(data);
      } catch (err) {
        throw new ZipFormatError(`entry "${name}" deflate decompression failed: ${err.message}`);
      }
      if (data.length !== entry.uncompSize) {
        throw new ZipFormatError(`entry "${name}" decompressed size ${data.length} != expected ${entry.uncompSize}`);
      }
    } else {
      throw new ZipFormatError(`entry "${name}" unsupported compression method ${method} (only stored/deflate)`);
    }
    if (crc32(data) !== crc) {
      throw new ZipFormatError(`entry "${name}" CRC32 mismatch (corrupt archive)`);
    }
    return data;
  }

  readModelDescription(zip) {
    const entry = zip.entries.get('modelDescription.xml');
    if (!entry) {
      throw new FmuError('MODEL_DESCRIPTION_MISSING', 'FMU package does not contain modelDescription.xml');
    }
    return parseModelDescription(entry.data.toString('utf8'));
  }

  readFmu(input) {
    const zip = this.readZip(input);
    const model = this.readModelDescription(zip);
    return { zip, model };
  }

  parseModelDescription(xmlText) {
    return parseModelDescription(xmlText);
  }
}

class FmuExecutionHost {
  constructor(model, options = {}) {
    if (!model || typeof model !== 'object' || !Array.isArray(model.variables)) {
      throw new TypeError('FmuExecutionHost requires a parsed model description');
    }
    if (model.fmiVersion !== '2.0') {
      throw new FmuExecutionError(`FmuExecutionHost supports FMI 2.0, got "${model.fmiVersion}"`);
    }
    this.model = model;
    this.solver = options.solver || 'rk4';
    this.stateNames = [];
    this.derivativeFns = {};
    const varByName = new Map(model.variables.map((v) => [v.name, v]));
    const derivativeFns = options.derivativeFns || {};
    for (const [name, fn] of Object.entries(derivativeFns)) {
      if (typeof fn !== 'function') throw new FmuExecutionError(`derivative for "${name}" must be a function`);
      const v = varByName.get(name);
      if (!v) throw new FmuExecutionError(`derivative registered for unknown variable "${name}"`);
      if (v.type.kind !== 'Real')
        throw new FmuExecutionError(`state "${name}" must be of type Real, got ${v.type.kind}`);
      this.derivativeFns[name] = fn;
      this.stateNames.push(name);
    }
    if (!this.stateNames.length) {
      throw new FmuExecutionError('at least one continuous-time state derivative must be registered');
    }
    this.values = new Map();
    for (const v of model.variables) {
      const start = model.startValues.get(v.name);
      this.values.set(v.name, start !== undefined ? start : 0);
    }
    this.inputs = new Map();
  }

  setInput(name, value) {
    const v = this.model.variables.find((x) => x.name === name);
    if (!v) throw new FmuExecutionError(`input "${name}" not found in model`);
    if (v.causality !== 'input') throw new FmuExecutionError(`"${name}" is not an input (causality=${v.causality})`);
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new FmuExecutionError(`input "${name}" must be a finite number`);
    }
    if (value !== undefined && typeof value !== 'number' && typeof value !== 'function') {
      throw new FmuExecutionError(`input "${name}" must be a finite number or a time function`);
    }
    this.inputs.set(name, value);
    return this;
  }

  getInputValue(t, name) {
    const spec = this.inputs.get(name);
    if (spec === undefined) return this.values.get(name) ?? 0;
    return typeof spec === 'function' ? spec(t) : spec;
  }

  _valueView(t, y) {
    const view = {};
    for (const v of this.model.variables) view[v.name] = this.values.get(v.name);
    for (let idx = 0; idx < this.stateNames.length; idx++) view[this.stateNames[idx]] = y[idx];
    for (const [name] of this.inputs) view[name] = this.getInputValue(t, name);
    return view;
  }

  _rightHandSide(t, y) {
    const view = this._valueView(t, y);
    return this.stateNames.map((name) => this.derivativeFns[name](t, view));
  }

  simulate(options = {}) {
    const t0 = options.t0 ?? 0;
    const tEnd = options.tEnd;
    if (!Number.isFinite(t0) || !Number.isFinite(tEnd) || tEnd <= t0) {
      throw new FmuExecutionError('simulate requires finite t0 < tEnd');
    }
    const span = tEnd - t0;
    if (span > MAX_SIM_SPAN) {
      throw new FmuExecutionError(`simulation span is limited to ${MAX_SIM_SPAN} time units`);
    }
    const method = options.method || this.solver;
    const y0 = this.stateNames.map((name) => this.values.get(name));
    const rhs = (t, y) => this._rightHandSide(t, y);
    let trajectory;
    if (method === 'rk4') {
      const dt = options.dt || 1e-3;
      if (!Number.isFinite(dt) || dt < MIN_RK4_DT) {
        throw new FmuExecutionError(`rk4 requires a finite dt of at least ${MIN_RK4_DT}`);
      }
      const steps = Math.ceil(span / dt);
      if (steps > MAX_SIM_STEPS) {
        throw new FmuExecutionError(`rk4 dt would require ${steps} steps; the maximum is ${MAX_SIM_STEPS}`);
      }
      trajectory = ODESolvers.solveRK4(rhs, y0, t0, tEnd, dt);
    } else if (method === 'rk45') {
      const tol = options.tol ?? 1e-6;
      const minH0 = span / MAX_SIM_STEPS;
      let h0 = options.h0 ?? Math.max(1e-3, span / 1000);
      if (!Number.isFinite(h0) || h0 <= 0) {
        throw new FmuExecutionError('rk45 requires a positive finite initial step h0');
      }
      if (h0 < minH0) {
        throw new FmuExecutionError(`rk45 h0 must be at least ${minH0} to stay within ${MAX_SIM_STEPS} steps`);
      }
      trajectory = ODESolvers.solveRK45(rhs, y0, t0, tEnd, tol, h0);
    } else {
      throw new FmuExecutionError(`unknown solver method "${method}" (supported: rk4, rk45)`);
    }
    const timeSeries = trajectory.map((pt) => {
      const y = {};
      for (let idx = 0; idx < this.stateNames.length; idx++) y[this.stateNames[idx]] = pt.y[idx];
      return { t: pt.t, y };
    });
    const last = timeSeries[timeSeries.length - 1];
    const finalState = { ...last.y };
    for (const [name, val] of this.values) {
      if (!(name in finalState)) finalState[name] = val;
    }
    for (let idx = 0; idx < this.stateNames.length; idx++) {
      this.values.set(this.stateNames[idx], last.y[this.stateNames[idx]]);
    }
    return {
      timeSeries,
      finalState,
      method,
      t0,
      tEnd,
      steps: trajectory.length,
      success: true
    };
  }
}

module.exports = {
  FmuError,
  ZipFormatError,
  ModelDescriptionError,
  FmuExecutionError,
  FmuReader,
  FmuExecutionHost,
  crc32,
  parseModelDescription
};
