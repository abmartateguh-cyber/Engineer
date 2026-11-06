/**
 * Real FMI 2.0 package reader verification.
 *
 * Feeds a hand-built .fmu zip (crafted with Node zlib + manual local-header
 * writer) containing modelDescription.xml for a two-state first-order system,
 * then asserts:
 *  - the pure-JS zip reader extracts the real manifest (stored + deflate),
 *  - the strict XML parser maps ScalarVariables / StartValues / ModelStructure
 *    exactly,
 *  - the FMU execution host integrates the parsed model against the analytic
 *    closed-form solution at t=10 within 1%,
 *  - malformed archives fail closed with typed errors.
 */

'use strict';

const assert = require('assert');
const zlib = require('zlib');
const {
  FmuReader,
  FmuExecutionHost,
  FmuError,
  ZipFormatError,
  ModelDescriptionError,
  FmuExecutionError
} = require('../src/core/cosim/fmu_reader');
const { CosimDomainRoute } = require('../src/core/cosim/cosim_domain_route');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v, 0);
  return b;
}

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return b;
}

function localHeader(name, method, crc, comp, uncomp) {
  const nb = Buffer.from(name, 'utf8');
  return Buffer.concat([
    u32(0x04034b50),
    u16(20),
    u16(0x0800),
    u16(method),
    u16(0),
    u16(0x21),
    u32(crc),
    u32(comp),
    u32(uncomp),
    u16(nb.length),
    u16(0),
    nb
  ]);
}

function centralEntry(name, method, crc, comp, uncomp, offset) {
  const nb = Buffer.from(name, 'utf8');
  return Buffer.concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0x0800),
    u16(method),
    u16(0),
    u16(0x21),
    u32(crc),
    u32(comp),
    u32(uncomp),
    u16(nb.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    nb
  ]);
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const data = e.method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const crc = crc32(e.data);
    const lh = localHeader(e.name, e.method, crc, data.length, e.data.length);
    locals.push(lh, data);
    centrals.push(centralEntry(e.name, e.method, crc, data.length, e.data.length, offset));
    offset += lh.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(cd.length),
    u32(offset),
    u16(0)
  ]);
  return Buffer.concat([...locals, cd, eocd]);
}

const GUID = '{8c4e59f0-1b2a-4c3d-9e4f-5a6b7c8d9e0f}';

const MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="TwoStateFirstOrder" guid="${GUID}"
    generationTool="OmniEng test fixture" variableNamingConvention="flat" numberOfContinuousStates="2">
  <CoSimulation modelIdentifier="TwoStateFirstOrder" needsExecutionTool="false"
      canHandleVariableCommunicationStepSize="true" canInterpolateInputs="true"
      maxOutputDerivativeOrder="0" canRunAsynchronously="false"/>
  <ModelVariables>
    <ScalarVariable name="u" valueReference="0" causality="input" variability="fixed" initial="exact">
      <Real start="1.0"/>
    </ScalarVariable>
    <ScalarVariable name="x1" valueReference="1" causality="output" variability="continuous" initial="exact" description="first state">
      <Real start="0.0"/>
    </ScalarVariable>
    <ScalarVariable name="x2" valueReference="2" causality="output" variability="continuous" initial="exact" description="second state">
      <Real start="0.0"/>
    </ScalarVariable>
  </ModelVariables>
  <ModelStructure>
    <Outputs>
      <Unknown index="1" name="x1"/>
      <Unknown index="2" name="x2"/>
    </Outputs>
    <Derivatives>
      <Unknown index="1" name="der(x1)" dependencies="u x1" dependenciesKind="dependent dependent"/>
      <Unknown index="2" name="der(x2)" dependencies="x1 x2" dependenciesKind="dependent dependent"/>
    </Derivatives>
    <InitialUnknowns>
      <Unknown index="1" name="x1"/>
      <Unknown index="2" name="x2"/>
    </InitialUnknowns>
  </ModelStructure>
</fmiModelDescription>
`;

function buildTestFmu() {
  return makeZip([
    { name: 'modelDescription.xml', method: 8, data: Buffer.from(MODEL_XML) },
    { name: 'resources/data.json', method: 0, data: Buffer.from('{"a":1,"b":[1,2,3]}') },
    { name: 'resources/note.txt', method: 8, data: Buffer.from('hello fmu\n') }
  ]);
}

function analytic(t) {
  return {
    x1: 1 - Math.exp(-t),
    x2: 2 - 4 * Math.exp(-0.5 * t) + 2 * Math.exp(-t)
  };
}

function assertWithin1Percent(actual, expected, label) {
  const rel = Math.abs(actual - expected) / Math.abs(expected);
  assert(rel < 0.01, `${label}: got ${actual}, expected ${expected}, relative error ${rel}`);
}

function derivativeFns() {
  return {
    x1: (t, v) => -v.x1 + v.u,
    x2: (t, v) => v.x1 - 0.5 * v.x2
  };
}

(async () => {
  console.log('================================================================');
  console.log('        TESTING REAL FMI 2.0 FMU READER (NO MOCKS)             ');
  console.log('================================================================\n');

  const reader = new FmuReader();
  const fmu = buildTestFmu();

  console.log('[1] ZIP reader: unzip extracts real manifest (stored + deflate)...');
  const zip = reader.readZip(fmu);
  assert.strictEqual(zip.entryCount, 3);
  const names = [...zip.entries.keys()];
  assert.deepStrictEqual(names.sort(), ['modelDescription.xml', 'resources/data.json', 'resources/note.txt']);
  const mdEntry = zip.entries.get('modelDescription.xml');
  assert.strictEqual(mdEntry.method, 8);
  assert.strictEqual(mdEntry.uncompressedSize, Buffer.byteLength(MODEL_XML));
  assert.strictEqual(mdEntry.crc32, crc32(Buffer.from(MODEL_XML)));
  assert(
    zip.entries.get('modelDescription.xml').data.equals(Buffer.from(MODEL_XML)),
    'modelDescription.xml content must round-trip exactly'
  );
  const dataEntry = zip.entries.get('resources/data.json');
  assert.strictEqual(dataEntry.method, 0);
  assert(dataEntry.data.equals(Buffer.from('{"a":1,"b":[1,2,3]}')), 'stored entry must round-trip exactly');
  assert(
    zip.entries.get('resources/note.txt').data.equals(Buffer.from('hello fmu\n')),
    'deflated text entry must round-trip exactly'
  );
  console.log('  ✓ PASSED: manifest extracted with correct methods, sizes, CRC32\n');

  console.log('[2] XML parser: modelDescription maps variables/startValues/modelStructure exactly...');
  const model = reader.parseModelDescription(MODEL_XML);
  assert.strictEqual(model.fmiVersion, '2.0');
  assert.strictEqual(model.modelName, 'TwoStateFirstOrder');
  assert.strictEqual(model.guid, GUID);
  assert.strictEqual(model.numberOfContinuousStates, 2);
  assert.strictEqual(model.capabilities.CoSimulation.modelIdentifier, 'TwoStateFirstOrder');
  assert.strictEqual(model.variables.length, 3);
  const byName = Object.fromEntries(model.variables.map((v) => [v.name, v]));
  assert.deepStrictEqual(byName.u, {
    name: 'u',
    valueReference: 0,
    causality: 'input',
    variability: 'fixed',
    initial: 'exact',
    description: undefined,
    type: { kind: 'Real', start: 1 }
  });
  assert.strictEqual(byName.x1.valueReference, 1);
  assert.strictEqual(byName.x1.causality, 'output');
  assert.strictEqual(byName.x1.variability, 'continuous');
  assert.strictEqual(byName.x1.type.kind, 'Real');
  assert.strictEqual(byName.x1.type.start, 0);
  assert.strictEqual(byName.x1.description, 'first state');
  assert.strictEqual(byName.x2.valueReference, 2);
  assert.strictEqual(byName.x2.type.start, 0);
  assert.deepStrictEqual(Object.fromEntries(model.startValues), { u: 1, x1: 0, x2: 0 });
  assert.deepStrictEqual(
    model.modelStructure.outputs.map((u) => u.name),
    ['x1', 'x2']
  );
  assert.deepStrictEqual(
    model.modelStructure.derivatives.map((u) => u.name),
    ['der(x1)', 'der(x2)']
  );
  assert.deepStrictEqual(model.modelStructure.derivatives[0].dependencies, ['u', 'x1']);
  assert.deepStrictEqual(
    model.modelStructure.initialUnknowns.map((u) => u.name),
    ['x1', 'x2']
  );
  console.log('  ✓ PASSED: exact variable map, start values, model structure\n');

  console.log('[3] FMU host: real ODE integration matches analytic solution at t=10 within 1%...');
  const host = new FmuExecutionHost(model, { derivativeFns: derivativeFns() });
  const result = host.simulate({ t0: 0, tEnd: 10, dt: 0.001, method: 'rk4' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.method, 'rk4');
  assert.strictEqual(result.timeSeries.length, 10001);
  assert.deepStrictEqual(result.timeSeries[0].y, { x1: 0, x2: 0 });
  const expected = analytic(10);
  assertWithin1Percent(result.finalState.x1, expected.x1, 'x1(10)');
  assertWithin1Percent(result.finalState.x2, expected.x2, 'x2(10)');
  console.log(
    `  ✓ PASSED: x1(10)=${result.finalState.x1.toFixed(10)} (analytic ${expected.x1.toFixed(10)}), x2(10)=${result.finalState.x2.toFixed(10)} (analytic ${expected.x2.toFixed(10)})\n`
  );

  console.log('[4] FMU host: adaptive rk45 integrator and setInput time-varying input...');
  const host45 = new FmuExecutionHost(model, { derivativeFns: derivativeFns() });
  host45.setInput('u', (t) => 0.5 + 0.5 * Math.exp(-t));
  const res45 = host45.simulate({ t0: 0, tEnd: 10, method: 'rk45', tol: 1e-8 });
  const x1Analytic = 0.5 + 4.5 * Math.exp(-10);
  assertWithin1Percent(res45.finalState.x1, x1Analytic, 'rk45 x1(10)');
  assert(res45.timeSeries.length > 10, 'adaptive solver must produce a trajectory');
  console.log(`  ✓ PASSED: rk45 x1(10)=${res45.finalState.x1.toFixed(10)} over ${res45.timeSeries.length} points\n`);

  console.log('[5] Fail-closed: malformed zips / XML raise typed errors...');
  assert.throws(
    () => reader.readZip(Buffer.from('this is not a zip archive at all')),
    (e) => e instanceof ZipFormatError && e.code === 'ZIP_FORMAT'
  );
  const truncated = fmu.subarray(0, fmu.length - 40);
  assert.throws(
    () => reader.readZip(truncated),
    (e) => e instanceof ZipFormatError && e.code === 'ZIP_FORMAT'
  );
  const fmuNoManifest = makeZip([{ name: 'README.md', method: 0, data: Buffer.from('no model') }]);
  assert.throws(
    () => reader.readFmu(fmuNoManifest),
    (e) => e instanceof FmuError && e.code === 'MODEL_DESCRIPTION_MISSING'
  );
  const badXml = makeZip([
    {
      name: 'modelDescription.xml',
      method: 0,
      data: Buffer.from('<fmiModelDescription fmiVersion="2.0"><ModelVariables>')
    }
  ]);
  assert.throws(
    () => reader.readFmu(badXml),
    (e) => e instanceof ModelDescriptionError
  );
  const unsupportedMethod = makeZip([{ name: 'modelDescription.xml', method: 99, data: Buffer.from(MODEL_XML) }]);
  assert.throws(
    () => reader.readZip(unsupportedMethod),
    (e) => e instanceof ZipFormatError && /unsupported compression method/.test(e.message)
  );
  const corruptedCrc = Buffer.from(fmu);
  const eocdOffset = fmu.length - 22;
  const cdOff = corruptedCrc.readUInt32LE(eocdOffset + 16);
  corruptedCrc[cdOff + 16] ^= 0xff;
  assert.throws(
    () => reader.readZip(corruptedCrc),
    (e) => e instanceof ZipFormatError && /CRC32 mismatch/.test(e.message)
  );
  console.log('  ✓ PASSED: all malformed inputs rejected with typed FmuError codes\n');

  console.log('[6] Domain route wiring: explicit cosim route serves read + simulate...');
  const route = new CosimDomainRoute();
  assert.deepStrictEqual(route.describeOperations(), ['read_fmu_package', 'parse_model_description', 'simulate_fmu']);
  const readResult = await route.execute('read_fmu_package', { fmu });
  assert.strictEqual(readResult.entryCount, 3);
  assert.deepStrictEqual(readResult.manifest.map((e) => e.name).sort(), [
    'modelDescription.xml',
    'resources/data.json',
    'resources/note.txt'
  ]);
  assert.strictEqual(readResult.model.variables.length, 3);
  const simResult = await route.execute('simulate_fmu', {
    fmu,
    derivatives: derivativeFns(),
    method: 'rk4',
    options: { t0: 0, tEnd: 10, dt: 0.001 }
  });
  assert.strictEqual(simResult.model.modelName, 'TwoStateFirstOrder');
  assert.strictEqual(simResult.simulation.success, true);
  assertWithin1Percent(simResult.simulation.finalState.x1, expected.x1, 'route x1(10)');
  assertWithin1Percent(simResult.simulation.finalState.x2, expected.x2, 'route x2(10)');
  await assert.rejects(route.execute('nope', {}), (e) => e instanceof FmuError && e.code === 'UNSUPPORTED_OPERATION');
  await assert.rejects(
    route.execute('simulate_fmu', { fmu, derivatives: { x1: (t, v) => -v.x1 } }),
    (e) => e instanceof FmuExecutionError
  );
  console.log('  ✓ PASSED: route serves package read and genuine simulation\n');

  const { FmiMasterEngine } = require('../src/core/cosim/fmi_master_engine');
  assert.strictEqual(typeof FmiMasterEngine, 'function');

  console.log('================================================================');
  console.log('   ALL FMU READER TESTS PASSED!                                ');
  console.log('================================================================\n');
})();
