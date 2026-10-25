/**
 * OmniEng EDA Domain IPC Router & Schema Definitions
 * Covers Verilog, SystemVerilog, DRC, LVS, SPICE, Gerber, GDSII, Clock Tree, BSIM4, STA, PEX
 */

'use strict';

const { defineHandler } = require('./define_handler');
const { LogicSynthesisEngine } = require('../../core/eda/logic_synthesis');
const { DRCEngine } = require('../../core/eda/drc_engine');
const { GerberExporter } = require('../../core/eda/gerber_exporter');
const { solveSpiceTransient } = require('../../core/eda/spice_request');
const { SystemVerilogSynthesizer } = require('../../core/eda/system_verilog_synth');
const { ClockTreeSynthesis, PathFinderRouter, BSIM4CompactModel } = require('../../core/eda/clock_tree_synthesis');
const { GdsiiStreamEngine, GdsLibrary, GdsRecordType } = require('../../core/eda/gdsii_stream');
const { MCMMStaticTimingEngine } = require('../../core/eda/mcmm_sta_engine');
const { ParasiticExtraction3D } = require('../../core/eda/parasitic_extraction_3d');
const { Sky130PdkAdapter } = require('../../core/eda/sky130_pdk_adapter');
const { LefDefParser } = require('../../core/eda/lef_def_parser');

function invalidEdaInput(message) {
  return {
    success: false,
    status: 'invalid-input',
    validationLevel: 'experimental',
    error: { code: 'INVALID_INPUT', message }
  };
}

function isEdaRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function handleVerilogSynthesisRequest(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    return invalidEdaInput('Explicit non-empty Verilog source is required.');
  }
  try {
    const result = LogicSynthesisEngine.synthesize(source);
    return result;
  } catch (error) {
    const unsupported = typeof error.message === 'string' && error.message.startsWith('UNSUPPORTED:');
    return {
      success: false,
      status: unsupported ? 'unavailable' : 'invalid-input',
      validationLevel: 'experimental',
      error: {
        code: unsupported ? 'UNSUPPORTED' : 'INVALID_INPUT',
        message: unsupported ? error.message.slice('UNSUPPORTED:'.length).trim() : error.message
      }
    };
  }
}

function handleSystemVerilogInspectionRequest(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    return invalidEdaInput('Explicit non-empty SystemVerilog source is required.');
  }
  try {
    const result = new SystemVerilogSynthesizer().synthesize(source);
    return {
      success: true,
      status: result.analysisStatus,
      operation: 'source-inspection',
      synthesisStatus: 'unavailable',
      validationLevel: 'experimental',
      inspection: {
        moduleName: result.moduleName,
        parameters: result.parameters,
        ports: result.ports,
        sequentialSyntaxDetected: result.sequentialSyntaxDetected
      },
      aigMetrics: result.aigMetrics,
      technologyMapping: result.technologyMapping,
      registers: result.registers
    };
  } catch (error) {
    return invalidEdaInput(error.message);
  }
}

function handleStandardCellLibraryRequest(params = {}) {
  if (!isEdaRecord(params)) return invalidEdaInput('A standard-cell library request object is required.');
  const { action, library } = params;
  if (!library) {
    return {
      success: false,
      status: 'unavailable',
      validationLevel: 'experimental',
      error: { code: 'UNSUPPORTED', message: 'No sourced PDK records are bundled; provide explicit library records.' }
    };
  }
  if (!['get-cells', 'generate-lef', 'compute-delay'].includes(action)) {
    return invalidEdaInput('An explicit supported action is required.');
  }

  try {
    const adapter = new Sky130PdkAdapter(library);
    if (action === 'get-cells') {
      return {
        success: true,
        validationLevel: 'experimental',
        dataStatus: adapter.dataStatus,
        provenance: adapter.provenance,
        libraryName: adapter.libraryName,
        cells: adapter.cells,
        layers: adapter.layers
      };
    }
    if (action === 'generate-lef') {
      const lef = adapter.generateLEF();
      return {
        success: true,
        validationLevel: 'experimental',
        dataStatus: adapter.dataStatus,
        provenance: adapter.provenance,
        libraryName: adapter.libraryName,
        lef,
        length: lef.length
      };
    }

    const missing = ['cellName', 'loadCapFf', 'corner'].filter(
      (key) => params[key] === undefined || params[key] === null
    );
    if (missing.length > 0) return invalidEdaInput(`Required delay inputs missing: ${missing.join(', ')}`);
    return { success: true, ...adapter.computeCellDelay(params.cellName, params.loadCapFf, params.corner) };
  } catch (error) {
    return invalidEdaInput(error.message);
  }
}

function handleLefParseRequest(params = {}) {
  if (!isEdaRecord(params)) return invalidEdaInput('A LEF parse request object is required.');
  if (typeof params.content !== 'string' || params.content.trim() === '') {
    return invalidEdaInput('Explicit non-empty LEF content is required.');
  }
  try {
    const parsed = LefDefParser.parseLEF(params.content);
    return {
      success: true,
      validationLevel: 'experimental',
      version: parsed.version,
      layerCount: Object.keys(parsed.layers).length,
      macroCount: Object.keys(parsed.macros).length,
      macros: Object.keys(parsed.macros)
    };
  } catch (error) {
    return invalidEdaInput(error.message);
  }
}

function handleDefParseRequest(params = {}) {
  if (!isEdaRecord(params)) return invalidEdaInput('A DEF parse request object is required.');
  if (typeof params.content !== 'string' || params.content.trim() === '') {
    return invalidEdaInput('Explicit non-empty DEF content is required.');
  }
  try {
    const parsed = LefDefParser.parseDEF(params.content);
    return {
      success: true,
      validationLevel: 'experimental',
      name: parsed.name,
      dieArea: parsed.dieArea,
      componentCount: parsed.components.length,
      netCount: parsed.nets.length
    };
  } catch (error) {
    return invalidEdaInput(error.message);
  }
}

function handleDefSerializeRequest(params = {}) {
  if (!isEdaRecord(params)) return invalidEdaInput('A DEF serialization request object is required.');
  const defData = params.defData;
  if (!defData || typeof defData !== 'object' || Array.isArray(defData)) {
    return invalidEdaInput('Explicit DEF data is required.');
  }
  try {
    const defText = LefDefParser.serializeDEF(defData);
    return { success: true, validationLevel: 'experimental', defText, length: defText.length };
  } catch (error) {
    return invalidEdaInput(error.message);
  }
}

function handleGerberExportRequest(pcbData = {}) {
  if (!isEdaRecord(pcbData)) return invalidEdaInput('An explicit PCB layout object is required.');
  const required = ['traces', 'pads', 'vias', 'solderMaskOpenings', 'holes', 'boardOutline'];
  if (Object.keys(pcbData).length !== required.length || required.some((key) => !Object.hasOwn(pcbData, key))) {
    return invalidEdaInput('Provide only explicit traces, pads, vias, solderMaskOpenings, holes, and boardOutline.');
  }
  try {
    const pkg = GerberExporter.generatePackage(pcbData);
    return { success: true, validationLevel: 'experimental', package: pkg };
  } catch (error) {
    return invalidEdaInput(error.message);
  }
}

function handleDrcRequest(params = {}) {
  if (!isEdaRecord(params)) return invalidEdaInput('An experimental DRC request object is required.');
  if (Object.keys(params).length !== 2 || !Object.hasOwn(params, 'shapes') || !Object.hasOwn(params, 'rules')) {
    return invalidEdaInput('Provide only explicit shapes and rules.');
  }
  return DRCEngine.runDRC(params.shapes, params.rules);
}

function handleGdsiiExportRequest(params = {}) {
  if (!isEdaRecord(params)) return invalidEdaInput('A GDSII export request object is required.');
  const required = ['libName', 'userUnits', 'dbUnits', 'topCell', 'polygons'];
  if (Object.keys(params).length !== required.length || required.some((key) => !Object.hasOwn(params, key))) {
    return invalidEdaInput('Provide only explicit libName, userUnits, dbUnits, topCell, and polygons.');
  }
  const validName = (value, maxLength) =>
    typeof value === 'string' && value === value.trim() && /^[\x20-\x7e]+$/.test(value) && value.length <= maxLength;
  if (!validName(params.libName, 44) || !validName(params.topCell, 32)) {
    return invalidEdaInput('GDSII library and structure names must be non-empty printable ASCII within format limits.');
  }
  if (
    !Number.isFinite(params.userUnits) ||
    params.userUnits <= 0 ||
    !Number.isFinite(params.dbUnits) ||
    params.dbUnits <= 0
  ) {
    return invalidEdaInput('Explicit positive finite userUnits and dbUnits are required.');
  }
  if (!Array.isArray(params.polygons) || params.polygons.length === 0 || params.polygons.length > 10000) {
    return invalidEdaInput('Provide between 1 and 10,000 caller-supplied polygons.');
  }

  let totalPoints = 0;
  for (const polygon of params.polygons) {
    if (
      !isEdaRecord(polygon) ||
      Object.keys(polygon).length !== 3 ||
      !['layer', 'datatype', 'points'].every((key) => Object.hasOwn(polygon, key)) ||
      !Number.isInteger(polygon.layer) ||
      polygon.layer < 0 ||
      polygon.layer > 32767 ||
      !Number.isInteger(polygon.datatype) ||
      polygon.datatype < 0 ||
      polygon.datatype > 32767 ||
      !Array.isArray(polygon.points) ||
      polygon.points.length < 3 ||
      polygon.points.length > 4090
    ) {
      return invalidEdaInput('Each polygon requires integer layer/datatype values and 3–4,090 explicit points.');
    }
    const uniquePoints = new Set();
    for (const point of polygon.points) {
      if (
        !isEdaRecord(point) ||
        Object.keys(point).length !== 2 ||
        !Number.isInteger(point.x) ||
        !Number.isInteger(point.y) ||
        point.x < -2147483648 ||
        point.x > 2147483647 ||
        point.y < -2147483648 ||
        point.y > 2147483647
      ) {
        return invalidEdaInput('Every GDSII coordinate must be an explicit signed 32-bit database-unit integer.');
      }
      uniquePoints.add(`${point.x},${point.y}`);
    }
    if (uniquePoints.size < 3)
      return invalidEdaInput('Each GDSII polygon must contain at least three distinct vertices.');
    totalPoints += polygon.points.length;
    if (totalPoints > 100000) return invalidEdaInput('GDSII export is limited to 100,000 explicit points.');
  }

  try {
    const lib = new GdsLibrary(params.libName, params.userUnits, params.dbUnits);
    const top = lib.createStructure(params.topCell);
    for (const polygon of params.polygons) top.addPolygon(polygon.layer, polygon.datatype, polygon.points);
    const bytes = GdsiiStreamEngine.writeGdsii(lib);
    return {
      success: true,
      status: 'experimental',
      validationLevel: 'experimental',
      dataStatus: 'caller-supplied layout geometry',
      sizeBytes: bytes.length,
      base64: bytes.toString('base64'),
      warnings: ['Serialization does not validate design rules, foundry requirements, or downstream interoperability.']
    };
  } catch {
    return {
      success: false,
      status: 'numerical-failure',
      validationLevel: 'experimental',
      error: { code: 'INTERNAL', message: 'GDSII serialization failed for the supplied layout data.' }
    };
  }
}

function handleGdsiiImportRequest(input) {
  let bytes;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    bytes = Buffer.from(input);
  } else if (typeof input === 'string' && input.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(input)) {
    bytes = Buffer.from(input, 'base64');
    if (bytes.toString('base64') !== input)
      return invalidEdaInput('The supplied GDSII base64 must use canonical encoding.');
  } else {
    return invalidEdaInput('Provide non-empty GDSII bytes or canonical base64 content.');
  }
  if (bytes.length < 10 || bytes.length > 64 * 1024 * 1024) {
    return invalidEdaInput('GDSII input must be between 10 bytes and 64 MiB.');
  }
  const startsWithHeader = bytes.readUInt16BE(0) === 6 && bytes.readUInt16BE(2) === GdsRecordType.HEADER;
  const lastOffset = bytes.length - 4;
  const endsWithEndLibrary =
    bytes.readUInt16BE(lastOffset) === 4 && bytes.readUInt16BE(lastOffset + 2) === GdsRecordType.ENDLIB;
  if (!startsWithHeader || !endsWithEndLibrary) {
    return invalidEdaInput('GDSII content must begin with a HEADER record and end with ENDLIB.');
  }

  try {
    const lib = GdsiiStreamEngine.readGdsii(bytes);
    if (lib.name === 'PARSED_LIB' || lib.structures.size === 0) {
      return invalidEdaInput('GDSII content did not contain a named library with at least one structure.');
    }
    return {
      success: true,
      status: 'experimental',
      validationLevel: 'experimental',
      dataStatus: 'caller-supplied GDSII bytes',
      libraryName: lib.name,
      structureCount: lib.structures.size,
      structures: Array.from(lib.structures.keys()),
      warnings: ['Parsing does not validate full GDSII conformance, design rules, or foundry requirements.']
    };
  } catch {
    return invalidEdaInput('The supplied bytes could not be parsed as a complete GDSII library.');
  }
}

function hasExactEdaKeys(value, keys) {
  return (
    isEdaRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function handleClockTreeRequest(params = {}) {
  const fields = ['sinks', 'rootPosition', 'options', 'routingGrid', 'routeStart', 'routeEnd'];
  if (!hasExactEdaKeys(params, fields))
    return invalidEdaInput('Explicit clock sinks, model options, routing grid, and route endpoints are required.');
  if (!Array.isArray(params.sinks) || params.sinks.length < 2 || params.sinks.length > 256) {
    return invalidEdaInput('Provide between 2 and 256 caller-supplied clock sinks.');
  }
  const sinkIds = new Set();
  for (const sink of params.sinks) {
    if (!hasExactEdaKeys(sink, ['id', 'x', 'y', 'capPf']) || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(sink.id)) {
      return invalidEdaInput('Each clock sink requires a unique id, x/y location, and capPf value.');
    }
    if (
      [sink.x, sink.y, sink.capPf].some((value) => !Number.isFinite(value)) ||
      sink.capPf <= 0 ||
      sinkIds.has(sink.id)
    ) {
      return invalidEdaInput(
        'Clock sink locations must be finite, capacitance must be positive, and IDs must be unique.'
      );
    }
    sinkIds.add(sink.id);
  }
  if (
    !hasExactEdaKeys(params.rootPosition, ['x', 'y']) ||
    [params.rootPosition.x, params.rootPosition.y].some((value) => !Number.isFinite(value))
  ) {
    return invalidEdaInput('An explicit finite clock root position is required.');
  }
  const optionKeys = ['targetSkewPs', 'bufferDelayNs', 'wireResistancePerUm', 'wireCapacitancePerUmPf'];
  if (
    !hasExactEdaKeys(params.options, optionKeys) ||
    optionKeys.some((key) => !Number.isFinite(params.options[key]) || params.options[key] <= 0)
  ) {
    return invalidEdaInput('Provide positive finite target skew, buffer delay, wire resistance, and wire capacitance.');
  }
  if (!hasExactEdaKeys(params.routingGrid, ['width', 'height', 'layers'])) {
    return invalidEdaInput('An explicit routing grid width, height, and layer count are required.');
  }
  const { width, height, layers } = params.routingGrid;
  if (
    ![width, height, layers].every(Number.isInteger) ||
    width < 1 ||
    height < 1 ||
    layers < 1 ||
    layers > 16 ||
    width * height * layers > 262144
  ) {
    return invalidEdaInput('Routing grid dimensions must be positive integers with at most 262,144 cells.');
  }
  const validPoint = (point) =>
    hasExactEdaKeys(point, ['x', 'y', 'layer']) &&
    [point.x, point.y, point.layer].every(Number.isInteger) &&
    point.x >= 0 &&
    point.x < width &&
    point.y >= 0 &&
    point.y < height &&
    point.layer >= 0 &&
    point.layer < layers;
  if (!validPoint(params.routeStart) || !validPoint(params.routeEnd)) {
    return invalidEdaInput('Route endpoints must be integer coordinates inside the supplied routing grid.');
  }

  const tree = ClockTreeSynthesis.synthesizeHTree(params.sinks, params.rootPosition, params.options);
  const router = new PathFinderRouter(width, height, layers);
  const route = router.routeNet(params.routeStart, params.routeEnd);
  return {
    success: true,
    status: 'experimental',
    validationLevel: 'experimental',
    dataStatus: 'caller-supplied inputs',
    tree,
    route,
    warnings: ['Clock and route estimates are not correlated to a PDK, extracted interconnect, or foundry flow.']
  };
}

function validateBsimModel(model, expectedType) {
  const keys = ['type', 'W', 'L', 'tox', 'Vth0', 'mu0', 'vsat', 'dibl_eta', 'lambda'];
  if (!hasExactEdaKeys(model, keys) || model.type !== expectedType) return false;
  if (![model.W, model.L, model.tox, model.mu0, model.vsat].every((value) => Number.isFinite(value) && value > 0))
    return false;
  return (
    Number.isFinite(model.Vth0) &&
    model.Vth0 !== 0 &&
    Number.isFinite(model.dibl_eta) &&
    model.dibl_eta >= 0 &&
    Number.isFinite(model.lambda) &&
    model.lambda >= 0
  );
}

function handleBsim4VtcRequest(params = {}) {
  if (!hasExactEdaKeys(params, ['nmos', 'pmos', 'bias', 'vddV', 'sweepPoints'])) {
    return invalidEdaInput(
      'Explicit NMOS/PMOS model parameters, bias values, supply voltage, and sweep points are required.'
    );
  }
  if (!validateBsimModel(params.nmos, 'nmos') || !validateBsimModel(params.pmos, 'pmos')) {
    return invalidEdaInput(
      'NMOS and PMOS models require explicit supported parameters and the matching transistor type.'
    );
  }
  if (
    !hasExactEdaKeys(params.bias, ['vgsV', 'vdsV', 'vbsV']) ||
    Object.values(params.bias).some((value) => !Number.isFinite(value))
  ) {
    return invalidEdaInput('Explicit finite gate-source, drain-source, and body-source bias voltages are required.');
  }
  if (
    !Number.isFinite(params.vddV) ||
    params.vddV <= 0 ||
    !Number.isInteger(params.sweepPoints) ||
    params.sweepPoints < 2 ||
    params.sweepPoints > 1000
  ) {
    return invalidEdaInput('vddV must be positive and sweepPoints must be an integer from 2 to 1,000.');
  }

  try {
    const nmos = new BSIM4CompactModel(params.nmos);
    const pmos = new BSIM4CompactModel(params.pmos);
    const idSat = nmos.computeCurrent(params.bias.vgsV, params.bias.vdsV, params.bias.vbsV);
    const vtc = BSIM4CompactModel.solveInverterVTC(nmos, pmos, params.vddV, params.sweepPoints);
    if (!Number.isFinite(idSat) || !vtc.curvePoints) {
      return {
        success: false,
        status: 'numerical-failure',
        validationLevel: 'experimental',
        error: { code: 'NUMERICAL_FAILURE', message: 'The experimental transistor model returned an invalid result.' }
      };
    }
    return {
      success: true,
      status: 'experimental',
      validationLevel: 'experimental',
      dataStatus: 'caller-supplied unverified model parameters',
      idSat,
      vtc,
      warnings: ['This simplified compact model is not a foundry-qualified BSIM4 model and is not calibrated to a PDK.']
    };
  } catch {
    return {
      success: false,
      status: 'numerical-failure',
      validationLevel: 'experimental',
      error: { code: 'NUMERICAL_FAILURE', message: 'The experimental transistor calculation failed.' }
    };
  }
}

function handlePlaceAndRouteRequest(params = {}) {
  if (!hasExactEdaKeys(params, ['options', 'cells', 'nets'])) {
    return invalidEdaInput('Explicit placement options, cells, and nets are required.');
  }
  if (!hasExactEdaKeys(params.options, ['coreWidth', 'coreHeight', 'stdCellHeight'])) {
    return invalidEdaInput('Explicit coreWidth, coreHeight, and stdCellHeight values are required.');
  }
  const { coreWidth, coreHeight, stdCellHeight } = params.options;
  if (
    ![coreWidth, coreHeight, stdCellHeight].every((value) => Number.isFinite(value) && value > 0) ||
    coreWidth <= 20 ||
    stdCellHeight > coreHeight
  ) {
    return invalidEdaInput(
      'Placement dimensions must be positive; the core must exceed 20 micrometres and fit at least one row.'
    );
  }
  if (
    !Array.isArray(params.cells) ||
    params.cells.length === 0 ||
    params.cells.length > 10000 ||
    !Array.isArray(params.nets) ||
    params.nets.length > 10000
  ) {
    return invalidEdaInput('Provide 1–10,000 caller-supplied cells and an explicit nets array.');
  }
  const cellIds = new Set();
  for (const cell of params.cells) {
    if (
      !hasExactEdaKeys(cell, ['id', 'width', 'height']) ||
      typeof cell.id !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(cell.id) ||
      cellIds.has(cell.id)
    ) {
      return invalidEdaInput('Each cell requires a unique ID, width, and height.');
    }
    if (
      ![cell.width, cell.height].every((value) => Number.isFinite(value) && value > 0) ||
      cell.width > coreWidth - 20 ||
      cell.height > stdCellHeight
    ) {
      return invalidEdaInput('Cell dimensions must be positive and fit the explicitly supplied core and row height.');
    }
    cellIds.add(cell.id);
  }
  const netNames = new Set();
  for (const net of params.nets) {
    if (
      !hasExactEdaKeys(net, ['name', 'pins']) ||
      typeof net.name !== 'string' ||
      net.name.length === 0 ||
      netNames.has(net.name) ||
      !Array.isArray(net.pins) ||
      net.pins.length !== 2
    ) {
      return invalidEdaInput('Each experimental route requires a unique net name and exactly two endpoint cell IDs.');
    }
    if (net.pins.some((pin) => typeof pin !== 'string' || !cellIds.has(pin))) {
      return invalidEdaInput('Every net endpoint must identify a supplied cell.');
    }
    netNames.add(net.name);
  }

  try {
    const { PlaceAndRouteEngine } = require('../../core/eda/place_and_route_engine');
    const pnr = new PlaceAndRouteEngine(params.options);
    const result = pnr.runPlaceAndRoute({ cells: params.cells, nets: params.nets });
    if (result.success === false) return result;
    return {
      success: true,
      ...result,
      validationLevel: 'experimental',
      dataStatus: 'caller-supplied cells and nets',
      warnings: [
        'The placement and two-pin Manhattan routes are experimental; overlap, DRC, timing, and foundry checks are not performed.'
      ]
    };
  } catch {
    return {
      success: false,
      status: 'invalid-input',
      validationLevel: 'experimental',
      error: { code: 'INVALID_INPUT', message: 'The supplied placement request could not be evaluated.' }
    };
  }
}

function registerEdaIpc() {
  // 1. Verilog Logic Synthesis
  defineHandler(
    'omni:synthesize-verilog',
    {
      type: 'string',
      maxLength: 1000000
    },
    async (event, source) => handleVerilogSynthesisRequest(source),
    {
      domain: 'eda',
      description:
        'Inspect a limited assignment subset with illustrative uncharacterized gate values; no frequency or slack result is calculated'
    }
  );

  // 2. Design Rule Checking (DRC)
  defineHandler(
    'omni:run-drc',
    {
      type: 'object',
      required: ['shapes', 'rules'],
      additionalProperties: false,
      properties: {
        shapes: {
          type: 'array',
          minItems: 1,
          maxItems: 2000,
          items: {
            type: 'object',
            required: ['id', 'layer', 'x', 'y', 'w', 'h'],
            properties: {
              id: { type: 'string', maxLength: 128 },
              layer: { type: 'string', maxLength: 128 },
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number', min: 0 },
              h: { type: 'number', min: 0 }
            }
          }
        },
        rules: {
          type: 'object',
          required: ['minWidth', 'minSpacing', 'minArea'],
          additionalProperties: false,
          properties: {
            minWidth: { type: 'number', min: 0 },
            minSpacing: { type: 'number', min: 0 },
            minArea: { type: 'number', min: 0 }
          }
        }
      }
    },
    async (event, params = {}) => handleDrcRequest(params),
    {
      domain: 'eda',
      description:
        'Apply caller-supplied positive limits to up to 2,000 validated rectangles; no foundry DRC or signoff'
    }
  );

  // 3. Layout Versus Schematic (LVS)
  defineHandler(
    'omni:run-lvs',
    {
      type: 'object',
      required: ['schematic', 'layout'],
      additionalProperties: false,
      properties: {
        schematic: { type: 'object' },
        layout: { type: 'object' }
      }
    },
    async (event, { schematic, layout }) => {
      return DRCEngine.runLVS(schematic, layout);
    },
    {
      domain: 'eda',
      description:
        'Compare supplied schematic and extracted instances with a one-to-one name/cell-type heuristic; no pin/net graph comparison or signoff'
    }
  );

  // 4. Export RS-274X Extended Gerber
  defineHandler(
    'omni:export-gerber',
    {
      type: 'object',
      required: ['traces', 'pads', 'vias', 'solderMaskOpenings', 'holes', 'boardOutline'],
      additionalProperties: false,
      properties: {
        traces: { type: 'array', maxItems: 10000 },
        pads: { type: 'array', maxItems: 10000 },
        vias: { type: 'array', maxItems: 10000 },
        solderMaskOpenings: { type: 'array', maxItems: 10000 },
        holes: { type: 'array', maxItems: 10000 },
        boardOutline: { type: 'object' }
      }
    },
    async (event, pcbData = {}) => handleGerberExportRequest(pcbData),
    {
      domain: 'eda',
      description:
        'Export caller-supplied experimental Gerber and Excellon layer files; no design data or manufacturing rules are synthesized'
    }
  );

  // 5. SPICE Mixed-Signal Engine
  defineHandler(
    'omni:solve-spice-circuit',
    {
      type: 'object',
      required: ['analysis', 'components'],
      properties: {
        analysis: { type: 'object' },
        components: { type: 'array' }
      }
    },
    async (event, request = {}) => solveSpiceTransient(request),
    {
      domain: 'eda',
      description:
        'Solve an experimental transient circuit from explicit caller-supplied components and SI-valued inputs'
    }
  );

  // 6. SystemVerilog IEEE 1800 AST Synthesis
  defineHandler(
    'omni:synthesize-system-verilog',
    {
      type: 'object',
      required: ['code'],
      properties: {
        code: { type: 'string', maxLength: 1000000 }
      }
    },
    async (event, params = {}) => handleSystemVerilogInspectionRequest(params.code),
    {
      domain: 'eda',
      description:
        'Inspect caller-supplied SystemVerilog declarations; RTL elaboration, logic synthesis, and technology mapping are unavailable'
    }
  );

  // 7. Clock Tree Synthesis & PathFinder Routing
  defineHandler(
    'omni:synthesize-clock-tree',
    {
      type: 'object',
      required: ['sinks', 'rootPosition', 'options', 'routingGrid', 'routeStart', 'routeEnd'],
      properties: {
        sinks: { type: 'array', minItems: 2, maxItems: 256 },
        rootPosition: { type: 'object' },
        options: { type: 'object' },
        routingGrid: { type: 'object' },
        routeStart: { type: 'object' },
        routeEnd: { type: 'object' }
      }
    },
    async (event, params = {}) => handleClockTreeRequest(params),
    {
      domain: 'eda',
      description: 'Run experimental clock-tree and grid-route calculations from explicit caller inputs'
    }
  );

  // 8. BSIM4 Transistor Model & Inverter VTC
  defineHandler(
    'omni:solve-bsim4-vtc',
    {
      type: 'object',
      required: ['nmos', 'pmos', 'bias', 'vddV', 'sweepPoints'],
      properties: {
        nmos: { type: 'object' },
        pmos: { type: 'object' },
        bias: { type: 'object' },
        vddV: { type: 'number', min: Number.MIN_VALUE },
        sweepPoints: { type: 'number', min: 2, max: 1000 }
      }
    },
    async (event, params = {}) => handleBsim4VtcRequest(params),
    {
      domain: 'eda',
      description: 'Evaluate an experimental compact transistor model from caller-supplied parameters and bias'
    }
  );

  // 9. Export Binary GDSII Stream
  defineHandler(
    'omni:export-gdsii',
    {
      type: 'object',
      required: ['libName', 'userUnits', 'dbUnits', 'topCell', 'polygons'],
      properties: {
        libName: { type: 'string', minLength: 1, maxLength: 44 },
        userUnits: { type: 'number', min: Number.MIN_VALUE },
        dbUnits: { type: 'number', min: Number.MIN_VALUE },
        topCell: { type: 'string', minLength: 1, maxLength: 32 },
        polygons: {
          type: 'array',
          minItems: 1,
          maxItems: 10000,
          items: { type: 'object' }
        }
      }
    },
    async (event, params = {}) => handleGdsiiExportRequest(params),
    {
      domain: 'eda',
      description:
        'Serialize caller-supplied geometry as experimental GDSII; no design-rule or foundry signoff is performed'
    }
  );

  // 10. Import Binary GDSII Stream
  defineHandler(
    'omni:import-gdsii',
    { type: 'buffer', maxBytes: 64 * 1024 * 1024 },
    async (event, input) => handleGdsiiImportRequest(input),
    {
      domain: 'eda',
      description: 'Parse caller-supplied GDSII bytes into an experimental structure summary'
    }
  );

  // 11. Multi-Corner Multi-Mode (MCMM) STA
  defineHandler(
    'omni:run-mcmm-sta',
    {
      type: 'object',
      required: ['clockPeriodNs', 'logicDelayTypNs', 'clockSkewNs', 'tCqTypNs', 'tSetupTypNs', 'tHoldTypNs', 'corners'],
      properties: {
        clockPeriodNs: { type: 'number', min: Number.MIN_VALUE },
        logicDelayTypNs: { type: 'number', min: 0 },
        clockSkewNs: { type: 'number', min: 0 },
        tCqTypNs: { type: 'number', min: 0 },
        tSetupTypNs: { type: 'number', min: 0 },
        tHoldTypNs: { type: 'number', min: 0 },
        corners: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: {
            type: 'object',
            required: ['name', 'voltage', 'temperatureC', 'processScale'],
            properties: {
              name: { type: 'string', maxLength: 64 },
              voltage: { type: 'number', min: Number.MIN_VALUE },
              temperatureC: { type: 'number' },
              processScale: { type: 'number', min: Number.MIN_VALUE }
            }
          }
        }
      }
    },
    async (event, params = {}) => {
      try {
        const sta = MCMMStaticTimingEngine.runMCMMAnalysis(params);
        return { success: true, result: sta };
      } catch (error) {
        return invalidEdaInput(error.message);
      }
    },
    {
      domain: 'eda',
      description: 'Run an experimental timing screen using explicitly supplied path assumptions and corner factors'
    }
  );

  // 12. 3D Parasitic Extraction (PEX)
  defineHandler(
    'omni:extract-pex-3d',
    {
      type: 'object',
      required: [
        'lengthUm',
        'widthUm',
        'thicknessUm',
        'spacingUm',
        'dielectricHeightUm',
        'dielectricPermittivity',
        'resistivityOhmM'
      ],
      properties: {
        lengthUm: { type: 'number', min: Number.MIN_VALUE },
        widthUm: { type: 'number', min: Number.MIN_VALUE },
        thicknessUm: { type: 'number', min: Number.MIN_VALUE },
        spacingUm: { type: 'number', min: Number.MIN_VALUE },
        dielectricHeightUm: { type: 'number', min: Number.MIN_VALUE },
        dielectricPermittivity: { type: 'number', min: Number.MIN_VALUE },
        resistivityOhmM: { type: 'number', min: Number.MIN_VALUE }
      }
    },
    async (event, params = {}) => {
      try {
        const pex = ParasiticExtraction3D.extractWireRC(params);
        return { success: true, result: pex };
      } catch (error) {
        return invalidEdaInput(error.message);
      }
    },
    {
      domain: 'eda',
      description:
        'Run an experimental analytical RC estimate using explicitly supplied geometry and material properties; no PDK correlation is established'
    }
  );

  // 13. Analytical Place & Route (P&R) Engine
  defineHandler(
    'omni:eda-place-and-route',
    {
      type: 'object',
      required: ['options', 'cells', 'nets'],
      properties: {
        options: { type: 'object' },
        cells: { type: 'array', minItems: 1, maxItems: 10000 },
        nets: { type: 'array', maxItems: 10000 }
      }
    },
    async (event, params = {}) => handlePlaceAndRouteRequest(params),
    {
      domain: 'eda',
      description: 'Run experimental placement and routing from explicit caller-supplied core, cell, and net data'
    }
  );

  // 14. Compatibility route for caller-supplied standard-cell library records.
  defineHandler(
    'omni:eda-sky130-pdk',
    {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['get-cells', 'generate-lef', 'compute-delay'] }
      }
    },
    async (event, params = {}) => handleStandardCellLibraryRequest(params),
    { domain: 'eda', description: 'Experimental cell-library operations from caller-supplied library and corner data' }
  );

  // 15. IEEE LEF parser. The route does not synthesize a sample library.
  defineHandler(
    'omni:eda-parse-lef',
    {
      type: 'object',
      required: ['content'],
      properties: { content: { type: 'string', maxLength: 10000000 } }
    },
    async (event, params = {}) => handleLefParseRequest(params),
    { domain: 'eda', description: 'Parse caller-supplied LEF content into an experimental syntax representation' }
  );

  // 16. IEEE DEF parser. The route does not synthesize a sample design.
  defineHandler(
    'omni:eda-parse-def',
    {
      type: 'object',
      required: ['content'],
      properties: { content: { type: 'string', maxLength: 10000000 } }
    },
    async (event, params = {}) => handleDefParseRequest(params),
    { domain: 'eda', description: 'Parse caller-supplied DEF content into an experimental syntax representation' }
  );

  // 17. IEEE DEF 5.8 Serializer (Phase 4)
  defineHandler(
    'omni:eda-serialize-def',
    {
      type: 'object',
      required: ['defData'],
      properties: { defData: { type: 'object' } }
    },
    async (event, params = {}) => handleDefSerializeRequest(params),
    { domain: 'eda', description: 'Serialize caller-supplied placement and routing data as experimental DEF output' }
  );

  // 18. Ignition circuit example; unavailable pending sourced circuit data
  defineHandler(
    'omni:simulate-asi-ignition',
    {
      type: 'object',
      optional: true
    },
    async () => ({
      success: false,
      validationLevel: 'experimental',
      error: {
        code: 'UNSUPPORTED',
        message:
          'Ignition circuit simulation is unavailable because no sourced, independently reviewed circuit model is configured.'
      }
    }),
    {
      domain: 'eda',
      description: 'Unavailable experimental ignition circuit example; no source-verified circuit model exists'
    }
  );
}

module.exports = {
  registerEdaIpc,
  handleStandardCellLibraryRequest,
  handleVerilogSynthesisRequest,
  handleSystemVerilogInspectionRequest,
  handleLefParseRequest,
  handleDefParseRequest,
  handleDefSerializeRequest,
  handleGerberExportRequest,
  handleDrcRequest,
  handleGdsiiExportRequest,
  handleGdsiiImportRequest,
  handleClockTreeRequest,
  handleBsim4VtcRequest,
  handlePlaceAndRouteRequest
};
