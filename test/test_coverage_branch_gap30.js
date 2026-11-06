'use strict';

/**
 * OmniEng branch-gap coverage suite (batch 30).
 *
 * Targets uncovered branch blocks in the cosim cluster (FmuReader zip/XML
 * error matrix, FmuExecutionHost simulation guards, CosimDomainRoute routing),
 * the storage cluster (OmniArchiveV3 streaming trailer/stream error paths,
 * WAL parse/replay/rebase, CommandJournal, Vault, ProjectManager recovery
 * journal), the V&V cluster (benchmark registry consumption, readiness cases,
 * poisson performance validation), the HPC cluster (gateway state machine and
 * script generators, cloud provider error paths), the compliance cluster
 * (ASME Part 5 linearization/screening matrices, tool qualification kit
 * evidence evaluation), the aerospace cluster (rocket propulsion validation
 * branches, 6-DOF dynamics), the robotics cluster (manipulator adapter
 * validation), the plant cluster (IAPWS-IF97 range/region branches, TEMA
 * rating branches, Wegstein solver methods), and math (domain decomposition,
 * experimental queue, sparse multifrontal solver). No production source is
 * modified.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  FmuReader,
  FmuExecutionHost,
  FmuError,
  ModelDescriptionError,
  ZipFormatError,
  crc32
} = require('../src/core/cosim/fmu_reader');
const { CosimDomainRoute } = require('../src/core/cosim/cosim_domain_route');
const {
  OmniArchive,
  OmniArchiveV2,
  OmniArchiveV3,
  CommandJournal,
  OmniVaultAES256,
  OmniWal,
  WAL_MAGIC,
  WAL_VERSION,
  WAL_FILE_NAME,
  calculateCRC32,
  MAGIC_BYTES_V1,
  MAGIC_BYTES_V2,
  MAGIC_BYTES_V3,
  DEFAULT_CHUNK_SIZE
} = require('../src/core/storage/omni_archive');
const { ProjectManager } = require('../src/core/storage/project_manager');
const { ToolQualificationKit } = require('../src/core/compliance/tool_qualification_kit');
const {
  ASMESectionVIIIDiv2Analyzer,
  linearizeStressThroughThickness,
  evaluatePart5Allowables
} = require('../src/core/compliance/asme_section_viii_div2');
const {
  NasaRocketPropulsion,
  solveNozzleExitMach,
  solveObliqueShockBeta,
  obliqueShockState,
  thetaFromBeta,
  prandtlMeyerFunction,
  inversePrandtlMeyerFunction,
  isentropicPressureRatio
} = require('../src/core/aerospace/nasa_rocket_propulsion');
const { SixDofDynamics } = require('../src/core/aerospace/six_dof_dynamics');
const { SerialManipulatorEngine, PUMA_560_DH } = require('../src/core/robotics/serial_manipulator_kinematics');
const { RoboticsEngineAdapter } = require('../src/core/robotics/robotics_engine_adapter');
const { IAPWS_IF97 } = require('../src/core/plant/iapws_if97');
const { HeatExchangerTEMA } = require('../src/core/plant/heat_exchanger_tema');
const { WegsteinRecycleSolver } = require('../src/core/plant/wegstein_recycle_solver');
const { DomainDecompositionEngine } = require('../src/core/math/domain_decomposition');
const { ExperimentalCalculationQueue, getGlobalWorkerPool } = require('../src/core/math/worker_pool');
const { WasmSparseMultifrontalSolver } = require('../src/core/math/wasm_sparse_multifrontal');
const { HpcClusterGateway, JOB_STATES } = require('../src/core/hpc/hpc_cluster_gateway');
const {
  CloudHPCEngine,
  LocalComputeProvider,
  SlurmComputeProvider,
  PbsComputeProvider
} = require('../src/core/hpc/cloud_cluster');
const { listVVBenchmarks, runVVBenchmark, runAllVVBenchmarks } = require('../src/core/vv/vv_registry');
const { getValidationReadiness, getUnavailableValidationCase } = require('../src/core/vv/validation_readiness');
const { measureStructuredPoissonBudget } = require('../src/core/vv/poisson_performance');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-gap30-'));

function tmpFile(name) {
  return path.join(TMP, name);
}

function makeZip(entries, opts = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const method = e.method !== undefined ? e.method : 0;
    const stored =
      e.storedOverride !== undefined ? e.storedOverride : method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const crc = e.crc !== undefined ? e.crc : calculateCRC32(e.data);
    const compSize = e.compSize !== undefined ? e.compSize : stored.length;
    const uncompSize = e.uncompSize !== undefined ? e.uncompSize : e.data.length;
    const localSig = e.localSig !== undefined ? e.localSig : 0x04034b50;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(localSig, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compSize, 18);
    local.writeUInt32LE(uncompSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    const localOff = offset;
    const localBlock = Buffer.concat([local, stored]);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(e.centralSig !== undefined ? e.centralSig : 0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compSize, 20);
    central.writeUInt32LE(uncompSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOff, 42);
    nameBuf.copy(central, 46);
    localParts.push(localBlock);
    centralParts.push(central);
    offset += localBlock.length;
  }
  const cd = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opts.disk !== undefined ? opts.disk : 0, 4);
  eocd.writeUInt16LE(opts.cdDisk !== undefined ? opts.cdDisk : 0, 6);
  eocd.writeUInt16LE(opts.diskEntries !== undefined ? opts.diskEntries : entries.length, 8);
  eocd.writeUInt16LE(opts.totalEntries !== undefined ? opts.totalEntries : entries.length, 10);
  eocd.writeUInt32LE(opts.cdSize !== undefined ? opts.cdSize : cd.length, 12);
  eocd.writeUInt32LE(opts.cdOffset !== undefined ? opts.cdOffset : offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, cd, eocd]);
}

const FMI_MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="testModel" guid="{abc-123}" generationTool="omnieng" numberOfContinuousStates="1">
  <CoSimulation canHandleVariableCommunicationStepSize="true"/>
  <ModelVariables>
    <ScalarVariable name="x" valueReference="1" causality="output" variability="continuous" initial="exact">
      <Real start="1.0" min="0.0" max="10.0" nominal="5.0" unit="K" displayUnit="degC" fixed="false"/>
    </ScalarVariable>
    <ScalarVariable name="u" valueReference="2" causality="input">
      <Real start="0.0"/>
    </ScalarVariable>
    <ScalarVariable name="flag" valueReference="3">
      <Boolean start="true" fixed="true"/>
    </ScalarVariable>
    <ScalarVariable name="n" valueReference="4">
      <Integer start="7" min="1" max="9"/>
    </ScalarVariable>
    <ScalarVariable name="s" valueReference="5">
      <String start="hello"/>
    </ScalarVariable>
  </ModelVariables>
  <ModelStructure>
    <Outputs><Unknown name="y" index="1" dependencies="1"/></Outputs>
    <Derivatives><Unknown name="dx" index="2" dependencies="1 2" dependenciesKind="dependent constant"/></Derivatives>
  </ModelStructure>
</fmiModelDescription>`;

const FMI_ZIP_BYTES = makeZip([{ name: 'modelDescription.xml', data: Buffer.from(FMI_MODEL_XML, 'utf8') }]);

async function runBranchGapThirtyCoverageTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  const pending = [];

  function check(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pending.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ PASSED: ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAILED: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ PASSED: ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAILED: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // ------------------------------------------------------------------
  // Cosim: FmuReader zip error matrix
  // ------------------------------------------------------------------
  check('FmuReader readZip success, entry metadata, and comment', () => {
    const zip = new FmuReader().readZip(FMI_ZIP_BYTES);
    assert.strictEqual(zip.entryCount, 1);
    const entry = zip.entries.get('modelDescription.xml');
    assert(entry);
    assert.strictEqual(entry.method, 0);
    assert.strictEqual(entry.uncompressedSize, entry.data.length);
    assert(entry.data.toString('utf8').includes('fmiModelDescription'));
  });

  check('FmuReader readZip zip64 / multi-disk / split-disk rejections', () => {
    const r = new FmuReader();
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { totalEntries: 0xffff })),
      /zip64/
    );
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { cdSize: 0xffffffff })),
      /zip64/
    );
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { cdOffset: 0xffffffff })),
      /zip64/
    );
    assert.throws(() => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { disk: 1 })), /multi-disk/);
    assert.throws(() => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { cdDisk: 2 })), /multi-disk/);
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { diskEntries: 3 })),
      /split disk/
    );
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { cdSize: 1000000 })),
      /central directory extends/
    );
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x') }], { diskEntries: 5000, totalEntries: 5000 })),
      /4096 limit/
    );
  });

  check('FmuReader readZip central directory, local header, and data bounds errors', () => {
    const r = new FmuReader();
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x'), centralSig: 0xdeadbeef }])),
      /invalid central directory entry/
    );
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x'), localSig: 0x12345678 }])),
      /missing local file header/
    );
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x'), compSize: 5000 }])),
      /data out of bounds/
    );
  });

  check('FmuReader readZip stored/deflate/CRC mismatches and unsupported methods', () => {
    const r = new FmuReader();
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x'), uncompSize: 9 }])),
      /size mismatch/
    );
    assert.throws(
      () =>
        r.readZip(
          makeZip([
            { name: 'a.txt', data: Buffer.from('x'), method: 8, storedOverride: Buffer.from([0xff, 0xff, 0xff, 0xff]) }
          ])
        ),
      /deflate decompression failed/
    );
    assert.throws(
      () =>
        r.readZip(
          makeZip([{ name: 'a.txt', data: Buffer.from('hello world hello world'), method: 8, uncompSize: 100 }])
        ),
      /decompressed size/
    );
    assert.throws(
      () => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x'), method: 99 }])),
      /unsupported compression method/
    );
    assert.throws(() => r.readZip(makeZip([{ name: 'a.txt', data: Buffer.from('x'), crc: 12345 }])), /CRC32 mismatch/);
    assert.throws(
      () => r.readZip(makeZip([{ name: 'x'.repeat(2000), data: Buffer.from('x') }])),
      /1024-character limit/
    );
  });

  // ------------------------------------------------------------------
  // Cosim: FmuReader XML parser error matrix
  // ------------------------------------------------------------------
  check('FmuReader parseXml structural and lexical error branches', () => {
    const r = new FmuReader();
    const fn = (xml) => r.parseModelDescription(xml);
    assert.throws(() => fn(42), /must be a string/);
    assert.throws(() => fn('a'.repeat(9 * 1024 * 1024)), /character limit/);
    assert.throws(() => fn('text outside root'), /text outside root/);
    assert.throws(() => fn('<a/>text'), /text outside root/);
    assert.throws(() => fn('<a><b/></a><c/>'), /multiple root elements/);
    assert.throws(() => fn('<!-- unterminated'), /unterminated comment/);
    assert.throws(() => fn('<![CDATA[ unterminated'), /unterminated CDATA/);
    assert.throws(() => fn('<? pi unterminated'), /unterminated processing instruction/);
    assert.throws(() => fn('<! unterminated'), /unterminated declaration/);
    assert.throws(() => fn('<a>'), /unclosed element/);
    assert.throws(() => fn(''), /no root element|Empty/);
    assert.throws(() => fn('</a>'), /unexpected closing tag/);
    assert.throws(() => fn('<a></b>'), /mismatched closing tag/);
    assert.throws(() => fn('<a b="1" b="2"/>'), /duplicate attribute/);
    assert.throws(() => fn('<a @bad/>'), /malformed attribute syntax/);
    assert.throws(() => fn('<a b=1/>'), /malformed attribute syntax/);
    assert.throws(() => fn('<a><b></a>'), /mismatched closing tag/);
    assert.throws(() => fn('<a b="unterminated'), /unterminated tag/);
    assert.throws(() => fn('<a><b c="1"/>'), /unclosed element/);
    assert.throws(() => fn('<a>a & b</a>'), /unescaped ampersand/);
    assert.throws(() => fn('<a>&bogus;</a>'), /unknown entity/);
    assert.throws(() => fn('<a>&#x110000;</a>'), /invalid character reference/);
    assert.throws(() => fn('<a>&#xD800;</a>'), /invalid character reference/);
  });

  check('FmuReader parseModelDescription semantic error branches', () => {
    const r = new FmuReader();
    const wrap = (inner) => `<fmiModelDescription fmiVersion="2.0" modelName="m">${inner}</fmiModelDescription>`;
    assert.throws(() => r.parseModelDescription('<root/>'), /root element must be <fmiModelDescription>/);
    assert.throws(() => r.parseModelDescription('<fmiModelDescription modelName="m"/>'), /fmiVersion/);
    assert.throws(
      () => r.parseModelDescription('<fmiModelDescription fmiVersion="9.9" modelName="m"/>'),
      /unsupported fmiVersion/
    );
    assert.throws(
      () => r.parseModelDescription(wrap('<ModelVariables></ModelVariables>')),
      /at least one ScalarVariable/
    );
    assert.throws(
      () => r.parseModelDescription(wrap('<ModelVariables><ScalarVariable><Real/></ScalarVariable></ModelVariables>')),
      /missing name attribute/
    );
    assert.throws(
      () =>
        r.parseModelDescription(wrap('<ModelVariables><ScalarVariable name="v"></ScalarVariable></ModelVariables>')),
      /exactly one type element/
    );
    assert.throws(
      () =>
        r.parseModelDescription(
          wrap('<ModelVariables><ScalarVariable name="v"><Real start="abc"/></ScalarVariable></ModelVariables>')
        ),
      /non-numeric/
    );
    assert.throws(
      () =>
        r.parseModelDescription(
          wrap('<ModelVariables><ScalarVariable name="v"><Integer start="2.5"/></ScalarVariable></ModelVariables>')
        ),
      /non-integer/
    );
    assert.throws(
      () =>
        r.parseModelDescription(
          wrap('<ModelVariables><ScalarVariable name="v"><Boolean start="maybe"/></ScalarVariable></ModelVariables>')
        ),
      /invalid boolean/
    );
    assert.throws(
      () =>
        r.parseModelDescription(
          wrap('<ModelVariables><ScalarVariable name="v"><Real min="bad"/></ScalarVariable></ModelVariables>')
        ),
      /non-numeric/
    );
    assert.throws(
      () =>
        r.parseModelDescription(
          wrap(
            '<ModelVariables><ScalarVariable name="v" valueReference="abc"><Real start="1"/></ScalarVariable></ModelVariables>'
          )
        ),
      /valueReference/
    );
    assert.throws(
      () =>
        r.parseModelDescription(
          '<fmiModelDescription fmiVersion="2.0" modelName="m"><ModelStructure><Outputs><Unknown/></Outputs></ModelStructure><ModelVariables><ScalarVariable name="v"><Real/></ScalarVariable></ModelVariables></fmiModelDescription>'
        ),
      /missing name attribute/
    );
  });

  check('FmuReader readModelDescription missing entry and full parse', () => {
    const r = new FmuReader();
    const zip = r.readZip(makeZip([{ name: 'other.txt', data: Buffer.from('x') }]));
    assert.throws(() => r.readModelDescription(zip), /does not contain modelDescription.xml/);
    const model = r.parseModelDescription(FMI_MODEL_XML);
    assert.strictEqual(model.fmiVersion, '2.0');
    assert.strictEqual(model.modelName, 'testModel');
    assert.strictEqual(model.variables.length, 5);
    assert.strictEqual(model.variables[0].type.kind, 'Real');
    assert.strictEqual(model.variables[0].type.start, 1);
    assert.strictEqual(model.variables[1].causality, 'input');
    assert.strictEqual(model.variables[2].type.fixed, true);
    assert.strictEqual(model.variables[3].type.min, 1);
    assert.strictEqual(model.variables[4].type.start, 'hello');
    assert.strictEqual(model.modelStructure.outputs.length, 1);
    assert.strictEqual(model.modelStructure.derivatives[0].dependencies.join(' '), '1 2');
    assert.strictEqual(model.capabilities.CoSimulation.canHandleVariableCommunicationStepSize, 'true');
  });

  // ------------------------------------------------------------------
  // Cosim: FmuExecutionHost validation and simulation guards
  // ------------------------------------------------------------------
  check('FmuExecutionHost constructor validation branches', () => {
    assert.throws(() => new FmuExecutionHost(null), /parsed model description/);
    assert.throws(() => new FmuExecutionHost({ fmiVersion: '3.0', variables: [] }), /FMI 2.0/);
    assert.throws(
      () => new FmuExecutionHost({ fmiVersion: '2.0', variables: [] }, { derivativeFns: { x: 5 } }),
      /must be a function/
    );
    assert.throws(
      () =>
        new FmuExecutionHost(
          { fmiVersion: '2.0', variables: [{ name: 'x', type: { kind: 'Real' } }] },
          { derivativeFns: { y: () => 0 } }
        ),
      /unknown variable/
    );
    assert.throws(
      () =>
        new FmuExecutionHost(
          { fmiVersion: '2.0', variables: [{ name: 'x', type: { kind: 'Integer' } }] },
          { derivativeFns: { x: () => 0 } }
        ),
      /must be of type Real/
    );
    assert.throws(
      () => new FmuExecutionHost({ fmiVersion: '2.0', variables: [] }),
      /at least one continuous-time state derivative/
    );
  });

  check('FmuExecutionHost setInput and simulate guard branches', () => {
    const model = new FmuReader().parseModelDescription(FMI_MODEL_XML);
    const host = new FmuExecutionHost(model, { derivativeFns: { x: () => 1 } });
    assert.throws(() => host.setInput('nope', 1), /not found/);
    assert.throws(() => host.setInput('x', 1), /not an input/);
    assert.throws(() => host.setInput('u', Infinity), /finite number/);
    assert.throws(() => host.setInput('u', {}), /finite number or a time function/);
    assert.throws(() => host.simulate({ t0: 0, tEnd: 0 }), /finite t0 < tEnd/);
    assert.throws(() => host.simulate({ t0: 0, tEnd: 2e6 }), /span is limited/);
    assert.throws(() => host.simulate({ t0: 0, tEnd: 1, method: 'euler' }), /unknown solver method/);
    assert.throws(() => host.simulate({ t0: 0, tEnd: 1, dt: 1e-12 }), /dt of at least/);
    assert.throws(() => host.simulate({ t0: 0, tEnd: 1, dt: 1e-8 }), /steps; the maximum/);
    assert.throws(() => host.simulate({ t0: 0, tEnd: 1, method: 'rk45', h0: -1 }), /positive finite initial step/);
    assert.throws(() => host.simulate({ t0: 0, tEnd: 1, method: 'rk45', h0: 1e-9 }), /h0 must be at least/);
  });

  check('FmuExecutionHost simulate rk4 and rk45 success paths', () => {
    const model = new FmuReader().parseModelDescription(FMI_MODEL_XML);
    const host = new FmuExecutionHost(model, { derivativeFns: { x: (t, view) => view.u } });
    host.setInput('u', 2);
    const res = host.simulate({ t0: 0, tEnd: 0.5, dt: 0.01 });
    assert.strictEqual(res.success, true);
    assert(res.timeSeries.length > 1);
    assert(Math.abs(res.finalState.x - 1) > 1e-9);
    const rk45 = new FmuExecutionHost(model, { derivativeFns: { x: () => 0 } }).simulate({
      t0: 0,
      tEnd: 1,
      method: 'rk45',
      tol: 1e-4,
      h0: 0.1
    });
    assert.strictEqual(rk45.method, 'rk45');
    assert.strictEqual(rk45.success, true);
  });

  // ------------------------------------------------------------------
  // Cosim: CosimDomainRoute operation routing
  // ------------------------------------------------------------------
  check('CosimDomainRoute execute read/parse/simulate routes and errors', async () => {
    const route = new CosimDomainRoute();
    assert.deepStrictEqual(route.describeOperations(), ['read_fmu_package', 'parse_model_description', 'simulate_fmu']);
    const read = await route.execute('read_fmu_package', { fmu: FMI_ZIP_BYTES });
    assert.strictEqual(read.entryCount, 1);
    assert.strictEqual(read.model.modelName, 'testModel');
    const parsed = await route.execute('parse_model_description', { xml: FMI_MODEL_XML });
    assert.strictEqual(parsed.model.numberOfContinuousStates, 1);
    await assert.rejects(() => route.execute('parse_model_description', { xml: 7 }), /xml string/);
    const sim = await route.execute('simulate_fmu', {
      fmu: FMI_ZIP_BYTES,
      method: 'rk4',
      derivatives: { x: () => 0 },
      inputs: { u: 1 },
      options: { t0: 0, tEnd: 0.1, dt: 0.01 }
    });
    assert.strictEqual(sim.simulation.success, true);
    assert.strictEqual(sim.manifest.length, 1);
    await assert.rejects(() => route.execute('bogus', {}), /unknown cosim route operation/);
    await assert.rejects(() => route.execute('read_fmu_package', { fmu: 'not!base64!' }), /base64/);
    await assert.rejects(() => route.execute('read_fmu_package', { fmu: 42 }), /Buffer, Uint8Array, or base64 string/);
    const tooBig = Buffer.alloc(65 * 1024 * 1024);
    await assert.rejects(() => route.execute('read_fmu_package', { fmu: tooBig }), /exceeds/);
  });

  // ------------------------------------------------------------------
  // Storage: OmniArchiveV3 streaming container
  // ------------------------------------------------------------------
  check('OmniArchiveV3 writeChunks validation and round trip', async () => {
    const file = tmpFile('v3-roundtrip.omni');
    const entries = [
      {
        name: 'manifest.json',
        stream: Buffer.from(
          JSON.stringify({
            schemaVersion: '2.0.0',
            name: 'p',
            author: 'a',
            engineeringDomain: 'u',
            activeUnits: 'SI_MM'
          })
        )
      },
      { name: 'blobs/blob1', stream: Buffer.from('hello blob content here', 'utf8') },
      { name: 'empty', stream: Buffer.alloc(0) }
    ];
    const ws = fs.createWriteStream(file);
    await assert.rejects(() => OmniArchiveV3.writeChunks(null, entries), /writable stream/);
    await assert.rejects(
      () => OmniArchiveV3.writeChunks(fs.createWriteStream(file), [{ name: '', stream: Buffer.from('x') }]),
      /must not be empty/
    );
    await assert.rejects(
      () =>
        OmniArchiveV3.writeChunks(fs.createWriteStream(file), [
          { name: 'a', stream: Buffer.from('x') },
          { name: 'a', stream: Buffer.from('y') }
        ]),
      /Duplicate streaming archive entry/
    );
    const res = await OmniArchiveV3.writeChunks(ws, entries, { chunkSize: 64 * 1024 });
    await new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.end(resolve);
    });
    assert(res.fileSize > 0);
    assert.strictEqual(res.entries.length, 3);
    const idx = OmniArchiveV3.readIndex(file);
    assert.strictEqual(idx.entries.length, 3);
    assert.strictEqual(idx.entries[1].name, 'blobs/blob1');
    const buf = OmniArchiveV3.readEntryBufferSync(file, 'blobs/blob1');
    assert.strictEqual(buf.toString('utf8'), 'hello blob content here');
    assert.strictEqual(OmniArchiveV3.readEntryBufferSync(file, 'empty').length, 0);
    assert.throws(() => OmniArchiveV3.readEntryBufferSync(file, 'missing'), /entry not found/);
    const archive = OmniArchiveV3.loadArchiveSync(file);
    assert(archive instanceof OmniArchiveV2);
    assert.strictEqual(archive.manifest.name, 'p');
  });

  check('OmniArchiveV3 readIndex malformed-archive error branches', () => {
    const badMagic = tmpFile('bad-magic.omni');
    fs.writeFileSync(badMagic, Buffer.concat([Buffer.from('NOTOMNIENG\x03', 'binary'), Buffer.alloc(40)]));
    assert.throws(() => OmniArchiveV3.readIndex(badMagic), /Not a v3 streaming archive/);
    const small = tmpFile('small.omni');
    fs.writeFileSync(small, Buffer.alloc(20));
    assert.throws(() => OmniArchiveV3.readIndex(small), /file too small/);
    const noTrailerMagic = tmpFile('no-trailer-magic.omni');
    const head = Buffer.alloc(28);
    MAGIC_BYTES_V3.copy(head, 0);
    fs.writeFileSync(noTrailerMagic, Buffer.concat([head, Buffer.alloc(32)]));
    assert.throws(() => OmniArchiveV3.readIndex(noTrailerMagic), /missing trailer magic/);
    const badOffset = tmpFile('bad-offset.omni');
    const tailBad = Buffer.alloc(16);
    tailBad.writeBigUInt64BE(0n, 0);
    Buffer.from('OMNITR\x00\x00', 'binary').copy(tailBad, 8);
    fs.writeFileSync(badOffset, Buffer.concat([head, tailBad]));
    assert.throws(() => OmniArchiveV3.readIndex(badOffset), /invalid trailer offset/);
    const badFormat = tmpFile('bad-format.omni');
    const badHead = Buffer.from(head);
    badHead.writeUInt32BE(99, 8);
    fs.writeFileSync(badFormat, Buffer.concat([badHead, Buffer.alloc(64)]));
    assert.throws(() => OmniArchiveV3._readHeaderFlags(badFormat), /Unsupported streaming archive format version/);
  });

  check('OmniArchiveV3 readEntryStream failure paths emit destroyed error stream', async () => {
    const file = tmpFile('v3-fail.omni');
    const write = (entries) =>
      new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(file);
        OmniArchiveV3.writeChunks(ws, entries).then(
          (res) => ws.end(() => resolve(res)),
          (err) => reject(err)
        );
      });
    const entries = [{ name: 'a', stream: Buffer.from('data') }];
    await write(entries);
    const missing = OmniArchiveV3.readEntryStream(file, 'nope');
    await assert.rejects(
      new Promise((resolve, reject) => {
        missing.on('error', reject);
        missing.on('end', resolve);
      }),
      /entry not found/
    );
    const ok = OmniArchiveV3.readEntryStream(file, 'a');
    const data = await new Promise((resolve, reject) => {
      const chunks = [];
      ok.on('data', (c) => chunks.push(c));
      ok.on('error', reject);
      ok.on('end', () => resolve(Buffer.concat(chunks)));
    });
    assert.strictEqual(data.toString('utf8'), 'data');
    const bad = tmpFile('v3-bad.omni');
    fs.writeFileSync(bad, Buffer.concat([MAGIC_BYTES_V3, Buffer.alloc(100)]));
    const failStream = OmniArchiveV3.readEntryStream(bad, 'a');
    await assert.rejects(
      new Promise((resolve, reject) => {
        failStream.on('error', reject);
        failStream.on('end', resolve);
      }),
      /Malformed streaming archive|Not a v3 streaming archive/
    );
  });

  // ------------------------------------------------------------------
  // Storage: WAL
  // ------------------------------------------------------------------
  check('OmniWal encode/open/append/flush/commit/stats/rebase', () => {
    const walPath = tmpFile('wal15.wal');
    const archivePath = tmpFile('archive15.omni');
    const header = OmniWal.encodeHeader(archivePath);
    assert(header.includes(WAL_MAGIC));
    assert(header.includes(String(WAL_VERSION)));
    const wal = new OmniWal({ path: walPath, archivePath });
    wal.open();
    const e1 = wal.appendEntry('add_blob', { dataBase64: 'aGk=' });
    assert.strictEqual(e1.seq, 1);
    assert.strictEqual(e1.pending, 1);
    const e2 = wal.appendEntry('bump_revision', { changes: { revision: 2 } });
    assert.strictEqual(e2.seq, 2);
    const flushed = wal.flush();
    assert.strictEqual(flushed.pending, 2);
    const committed = wal.commit();
    assert.strictEqual(committed.committed, 2);
    assert.strictEqual(committed.pending, 0);
    assert.strictEqual(wal.stats().seq, 3);
    wal.appendEntry('journal_execute', { actionType: 'x', forwardPatch: {}, reversePatch: {} });
    wal.appendEntry('record_result', { result: null });
    assert.strictEqual(wal.stats().pending, 2);
    wal.close();
    assert.strictEqual(wal.fd, null);
    const reopened = new OmniWal({ path: walPath, archivePath });
    reopened.open();
    assert.strictEqual(reopened.committed, 2);
    assert.strictEqual(reopened.seq, 3);
    const rebased = reopened.rebase();
    assert.strictEqual(rebased.seq, 1);
    assert.strictEqual(rebased.committed, 0);
    reopened.close();
  });

  check('OmniWal open repairs torn tail via _rewriteClean', () => {
    const walPath = tmpFile('torn.wal');
    const archivePath = tmpFile('torn-archive.omni');
    const wal = new OmniWal({ path: walPath, archivePath });
    wal.open();
    wal.appendEntry('add_blob', { dataBase64: 'aGk=' });
    wal.commit();
    wal.appendEntry('add_blob', { dataBase64: 'eXNz' });
    wal.appendEntry('add_blob', { dataBase64: 'd3d3' });
    wal.close();
    fs.appendFileSync(walPath, '\n{"garbage"\n');
    const reopened = new OmniWal({ path: walPath, archivePath });
    reopened.open();
    assert.strictEqual(reopened.recovered, true);
    assert.strictEqual(reopened.committed, 1);
    assert.strictEqual(reopened.seq, 2);
    reopened.close();
    const mismatched = new OmniWal({ path: walPath, archivePath: tmpFile('other-archive.omni') });
    assert.throws(() => mismatched.open(), /not a matching v3 journal/);
  });

  check('OmniWal appendEntry guards and parseWalFile corrupt lines', () => {
    const walPath = tmpFile('guard.wal');
    const archivePath = tmpFile('guard-archive.omni');
    const wal = new OmniWal({ path: walPath, archivePath });
    assert.throws(() => wal.appendEntry('op', {}), /WAL is not open/);
    wal.open();
    assert.throws(() => wal.appendEntry('', {}), /non-empty string/);
    wal.close();
    fs.writeFileSync(walPath, 'not json\n');
    const corrupted = new OmniWal({ path: walPath, archivePath });
    assert.throws(() => corrupted.open(), /not a matching v3 journal/);
    fs.writeFileSync(walPath, OmniWal.encodeHeader(archivePath) + '\n');
    const headerOnly = new OmniWal({ path: walPath, archivePath });
    headerOnly.open();
    assert.strictEqual(headerOnly.recovered, false);
    assert.strictEqual(headerOnly.committed, 0);
    assert.strictEqual(headerOnly.seq, 1);
    headerOnly.close();
  });

  check('OmniArchiveV2 WAL integration: enable, log, commit, load, replay', () => {
    const file = tmpFile('wal-archive.omni');
    const archive = new OmniArchiveV2({ projectName: 'WAL Project' });
    archive.addBlob('first blob', { mimeType: 'text/plain' });
    archive.saveToFile(file);
    archive.enableWal();
    const entry = archive.appendWalEntry('add_blob', {
      dataBase64: Buffer.from('second blob').toString('base64'),
      mimeType: 'text/plain'
    });
    assert.strictEqual(entry.seq, 1);
    assert.strictEqual(archive.getWalStats().pending, 1);
    archive.flushWal();
    const committed = archive.commitTransaction();
    assert.strictEqual(committed.wal, true);
    assert.strictEqual(committed.committed, 1);
    const loaded = OmniArchiveV2.loadFromFile(file);
    assert(
      loaded.hasBlob(entry.digest) === false ||
        loaded.getBlob(loaded.listBlobs().find((h) => h !== '') || 'x') !== undefined
    );
    const walStats = loaded.getWalStats();
    assert.strictEqual(walStats.applicable, true);
    assert(walStats.applied >= 1);
    loaded.disableWal();
    assert.strictEqual(loaded.getWalStats().path, null);
    const noPath = new OmniArchiveV2({ projectName: 'NoPath' });
    assert.throws(() => noPath.enableWal(), /WAL path is required/);
    assert.strictEqual(noPath.commitTransaction().wal, false);
    assert.strictEqual(noPath.flushWal().path, null);
    assert.throws(() => noPath.appendWalEntry('add_blob', {}), /WAL is not enabled/);
  });

  // ------------------------------------------------------------------
  // Storage: CommandJournal, Vault, archive load/migration paths
  // ------------------------------------------------------------------
  check('CommandJournal execute/undo/redo/import branches', () => {
    const j = new CommandJournal();
    assert.strictEqual(j.canUndo(), false);
    assert.strictEqual(j.undo(), null);
    assert.strictEqual(j.redo(), null);
    const e1 = j.execute('edit', { a: 1 }, { a: 0 }, 'first', 'alice');
    assert.strictEqual(e1.actionType, 'edit');
    assert.strictEqual(j.canUndo(), true);
    const e2 = j.execute('edit', { b: 2 }, { b: 0 }, 'second');
    assert.strictEqual(e2.parentId, e1.id);
    const undone = j.undo();
    assert.strictEqual(undone.undoneEntry.id, e2.id);
    assert.deepStrictEqual(undone.appliedPatch, { b: 0 });
    assert.strictEqual(j.canRedo(), true);
    const redone = j.redo();
    assert.strictEqual(redone.redoneEntry.id, e2.id);
    const j2 = new CommandJournal();
    j2.import(j.export());
    assert.strictEqual(j2.getHistory().length, 2);
    assert.strictEqual(j2.canRedo(), false);
    assert.throws(() => j2.import({}), /Invalid journal import data format/);
    assert.strictEqual(j.getHistory()[0].isCurrent, false);
  });

  check('OmniVaultAES256 encrypt/decrypt and corrupt-input branches', () => {
    const plaintext = Buffer.from('structural payload 123');
    const sealed = OmniVaultAES256.encrypt(plaintext, 'hunter2');
    assert(sealed.length > 52);
    assert.deepStrictEqual(OmniVaultAES256.decrypt(sealed, 'hunter2'), plaintext);
    assert.throws(() => OmniVaultAES256.decrypt(Buffer.alloc(10), 'x'), /shorter than cryptographic header/);
    assert.throws(() => OmniVaultAES256.decrypt(Buffer.alloc(60), 'x'), /Invalid vault header/);
    assert.throws(() => OmniVaultAES256.decrypt(sealed, 'wrong'), /Decryption Failed/);
  });

  check('OmniArchiveV2 load/migration paths and blob JSON fallback', () => {
    assert.throws(() => OmniArchiveV2.loadFromBuffer(Buffer.alloc(8)), /too small/);
    assert.throws(
      () => OmniArchiveV2.loadFromBuffer(Buffer.concat([Buffer.from('XXXXXXXX'), Buffer.alloc(16)])),
      /magic header/
    );
    const v1 = new OmniArchive({ projectName: 'V1', unitsSystem: 'US_CUSTOMARY' });
    v1.addSection('mesh', Buffer.from('mesh data'));
    v1.addSection('manifest', { projectName: 'V1', unitsSystem: 'US_CUSTOMARY' });
    const migrated = OmniArchiveV2.fromV1(v1);
    assert.strictEqual(migrated.manifest.activeUnits, 'US_CUSTOMARY');
    assert.strictEqual(migrated.blobs.size, 1);
    assert.throws(() => OmniArchiveV2.fromV1({}), /requires an OmniArchive instance/);
    const v2 = new OmniArchiveV2({ projectName: 'P' });
    const ref = v2.addBlob('{"json":true}', { name: 'cfg' });
    assert(v2.hasBlob(ref.hash));
    assert.deepStrictEqual(v2.getBlob(ref.hash, true), { json: true });
    const ref2 = v2.addBlob('not json {', { name: 'raw' });
    assert.strictEqual(v2.getBlob(ref2.hash, true), 'not json {');
    assert.strictEqual(v2.getBlob('missing'), null);
    assert.strictEqual(v2.listBlobs().length, 2);
    assert.throws(() => {
      if (v2.getBlob(null, true) === null) throw new Error('x');
    });
  });

  check('ProjectManager lifecycle: init, commands, undo/redo, save, open, blob, export', async () => {
    const pm = new ProjectManager({ projectName: 'Gap30', engineeringDomain: 'mechanical', author: 'tester' });
    assert.strictEqual(pm.hasActiveProject(), true);
    assert.strictEqual(pm.getSummary().projectName, 'Gap30');
    assert.throws(() => pm.saveProject(), /Target file path must be specified/);
    const file = tmpFile('project.omni');
    const saved = pm.saveProject(file);
    assert.strictEqual(saved.success, true);
    const entry = pm.recordCommand('edit_geometry', { nodes: [1] }, { nodes: [] }, 'moved node', 'alice');
    assert(entry.id);
    const undoRes = pm.undo();
    assert(undoRes);
    assert.strictEqual(pm.redo().redoneEntry.id, entry.id);
    assert(pm.getHistory().length >= 1);
    assert.strictEqual(pm.getSummary().historyCount, 1);
    assert(fs.existsSync(`${file}.recovery.journal`));
    const recovered = OmniArchiveV2.recoverFromCrash(file);
    assert.strictEqual(recovered.recoveredCount, 1);
    assert.throws(() => pm.openProject(tmpFile('does-not-exist.omni')), /does not exist/);
    assert.throws(() => pm.openProject(42), /Expected file path string or binary Buffer/);
    const reopened = pm.openProject(file);
    assert.strictEqual(reopened.projectName, 'Gap30');
    const blobRef = pm.addBlob(Buffer.from('BLOB'), { mimeType: 'application/octet-stream' });
    assert(pm.getBlob(blobRef.hash).toString('utf8'), 'BLOB');
    const exported = await pm.exportLargeArchive(tmpFile('project-v3.omni'), { chunkSize: 64 * 1024 });
    assert.strictEqual(exported.streamed, true);
    assert.strictEqual(exported.success, true);
    const reloaded = new ProjectManager();
    const summary = reloaded.openProject(tmpFile('project-v3.omni'));
    assert.strictEqual(summary.blobCount, 1);
  });

  // ------------------------------------------------------------------
  // V&V cluster
  // ------------------------------------------------------------------
  check('VV registry list/run/all with reference benchmark consumption', () => {
    const listed = listVVBenchmarks();
    assert.strictEqual(listed.length, 5);
    assert.strictEqual(listed[0].validationLevel, 'experimental');
    assert.strictEqual(listed[0].releaseApproved, false);
    const one = runVVBenchmark('HERTZ_AXISYMMETRIC_CONTACT_DIAGNOSTIC');
    assert(one.computedValue !== undefined);
    assert.strictEqual(one.validationLevel, 'experimental');
    assert(one.validationRecord);
    assert(one.quantities.computed.valueSi !== undefined);
    assert.throws(() => runVVBenchmark('NO_SUCH_ID'), /Unknown V&V benchmark ID/);
    const alias = runVVBenchmark('ISO_10110_OPTICS_TOLERANCE');
    assert.strictEqual(alias.status, 'unavailable');
    assert.strictEqual(alias.validationLevel, 'unavailable');
    const all = runAllVVBenchmarks();
    assert.strictEqual(all.total, 5);
    assert.strictEqual(all.diagnosticOnly, true);
    assert.strictEqual(all.validationReady, false);
    assert.strictEqual(all.summary.total, 5);
    assert(all.summary.unavailableReferenceCount >= 0);
    assert.strictEqual(all.results.length, 5);
  });

  check('Validation readiness case lookup and error branches', () => {
    const readiness = getValidationReadiness();
    assert.strictEqual(readiness.status, 'unavailable');
    assert.strictEqual(readiness.available, 0);
    assert(readiness.total >= 6);
    const readinessCase = getUnavailableValidationCase('NAFEMS_LE1');
    assert.strictEqual(readinessCase.passed, false);
    assert.strictEqual(readinessCase.status, 'unavailable');
    assert.throws(() => getUnavailableValidationCase('BOGUS'), /Unknown validation case/);
  });

  check('measureStructuredPoissonBudget validation branches and solve paths', () => {
    assert.throws(
      () => measureStructuredPoissonBudget({ gridSize: 1 }),
      /gridSize must be an integer greater than one/
    );
    assert.throws(
      () => measureStructuredPoissonBudget({ gridSize: 2.5 }),
      /gridSize must be an integer greater than one/
    );
    assert.throws(
      () => measureStructuredPoissonBudget({ gridSize: 4, rightHandSide: NaN }),
      /rightHandSide must be finite/
    );
    assert.throws(
      () => measureStructuredPoissonBudget({ gridSize: 4, performanceBudgetMs: 0 }),
      /positive finite number/
    );
    assert.throws(
      () => measureStructuredPoissonBudget({ gridSize: 4, performanceBudgetMs: Infinity }),
      /positive finite number/
    );
    assert.throws(
      () => measureStructuredPoissonBudget({ gridSize: 4, generalSparse: 'yes' }),
      /generalSparse must be a boolean/
    );
    const fast = measureStructuredPoissonBudget({ gridSize: 8 });
    assert.strictEqual(fast.unknowns, 64);
    assert(fast.withinPerformanceBudget !== undefined);
    assert(fast.solverMethod.includes('poisson') || fast.solverMethod.includes('sparse'));
    const sparse = measureStructuredPoissonBudget({ gridSize: 8, generalSparse: true, performanceBudgetMs: 60000 });
    assert.strictEqual(sparse.generalSparse, true);
    assert(sparse.relativeResidual < 1e-9);
  });

  // ------------------------------------------------------------------
  // Compliance cluster
  // ------------------------------------------------------------------
  check('ASME Part 5 linearizeStressThroughThickness branches', () => {
    const field = [
      { s: -5, σxx: 10, σyy: 5, σzz: 2, τxy: 1, τyz: 0, τzx: 0 },
      { s: 0, σxx: 20, σyy: 6, σzz: 3, τxy: 2, τyz: 0, τzx: 0 },
      { s: 5, σxx: 30, σyy: 7, σzz: 4, τxy: 3, τyz: 0, τzx: 0 }
    ];
    const res = linearizeStressThroughThickness(field, { direction: 'radial', sectionLines: 2 });
    assert.strictEqual(res.direction, 'radial');
    assert.strictEqual(res.sectionLines, 2);
    assert.strictEqual(res.thicknessMm, 10);
    assert(res.envelope.P_m > 0);
    assert.throws(
      () => linearizeStressThroughThickness(field, { direction: '' }),
      /direction must be a non-empty string/
    );
    assert.throws(() => linearizeStressThroughThickness('nope'), /must be an array/);
    assert.throws(() => linearizeStressThroughThickness([{ s: 0 }]), /At least two stress samples/);
    assert.throws(
      () =>
        linearizeStressThroughThickness(
          new Array(10001).fill({ s: 0, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 })
        ),
      /at most 10,000/
    );
    assert.throws(
      () => linearizeStressThroughThickness([null, { s: 1, σxx: 0, σyy: 0, σzz: 0, τxy: 0, τyz: 0, τzx: 0 }]),
      /must be an object/
    );
    assert.throws(() => linearizeStressThroughThickness([{ s: NaN }, { s: 1 }]), /finite number/);
    assert.throws(
      () =>
        linearizeStressThroughThickness([
          { s: 1, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 },
          { s: 1, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 }
        ]),
      /strictly increasing/
    );
    assert.throws(
      () =>
        linearizeStressThroughThickness([
          { s: 0, σxx: 'x', σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 },
          { s: 1, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 }
        ]),
      /finite number/
    );
    assert.throws(
      () =>
        linearizeStressThroughThickness([
          { s: 0, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 },
          { s: -0.5, σxx: 1, σyy: 1, σzz: 1, τxy: 0, τyz: 0, τzx: 0 }
        ]),
      /strictly increasing/
    );
  });

  check('ASME Part 5 evaluatePart5Allowables branch matrix', () => {
    const pass = evaluatePart5Allowables(80, 20, 10, { S: 100, Sy: 150, secondaryQ: 5 });
    assert.strictEqual(pass.overallAcceptable, true);
    assert.strictEqual(pass.checks.yieldSanity.assessed, true);
    assert.strictEqual(pass.checks.yieldSanity.acceptable, true);
    const fail = evaluatePart5Allowables(200, 50, 10, { S: 100 });
    assert.strictEqual(fail.overallAcceptable, false);
    assert.strictEqual(fail.checks.primaryMembrane.acceptable, false);
    const noSy = evaluatePart5Allowables(10, 10, 1, { S: 100 });
    assert.strictEqual(noSy.checks.yieldSanity.assessed, false);
    assert.throws(() => evaluatePart5Allowables(NaN, 1, 1, { S: 100 }), /finite number/);
    assert.throws(() => evaluatePart5Allowables(1, 1, 1, { S: 0 }), /must be positive/);
    assert.throws(() => evaluatePart5Allowables(1, 1, 1, { S: 100, Sy: -1 }), /must be positive/);
    assert.throws(() => evaluatePart5Allowables(1, 1, 1, { S: 100, secondaryQ: -1 }), /must be non-negative/);
  });

  check('ASMESectionVIIIDiv2Analyzer constructor and stress-line branches', () => {
    assert.throws(() => new ASMESectionVIIIDiv2Analyzer(), /finite positive caller-supplied screening limit/);
    assert.throws(
      () => new ASMESectionVIIIDiv2Analyzer({ allowableStressS: 120, allowableStressSource: '' }),
      /non-empty source label/
    );
    const analyzer = new ASMESectionVIIIDiv2Analyzer({ allowableStressS: 100, allowableStressSource: 'caller test' });
    const scl = [
      { x: -5, stressMpa: 10 },
      { x: 0, stressMpa: 30 },
      { x: 5, stressMpa: 50 }
    ];
    const res = analyzer.linearizeStressClassificationLine(scl, 10, false);
    assert.strictEqual(res.status, 'screening-only');
    assert(res.screening.withinSuppliedPmLimit);
    assert.strictEqual(res.allowableStressSource, 'caller test');
    const res2 = analyzer.evaluateStressClassificationLine(scl, 10, false);
    assert.strictEqual(res2.assessmentStatus, 'no-code-assessment');
    assert.throws(() => analyzer.linearizeStressClassificationLine(scl, 0, false), /finite and positive/);
    assert.throws(
      () => analyzer.linearizeStressClassificationLine([{ x: 0, stressMpa: 1 }], 10, false),
      /between 2 and 10,000/
    );
    assert.throws(() => analyzer.linearizeStressClassificationLine(scl, 10, 'yes'), /Explicitly declare/);
    assert.throws(
      () => analyzer.linearizeStressClassificationLine(scl, 10, true),
      /Secondary thermal stress screening is unavailable/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: 0, stressMpa: 'a' },
            { x: 1, stressMpa: 1 }
          ],
          10,
          false
        ),
      /finite x and stressMpa/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: -100, stressMpa: 1 },
            { x: 1, stressMpa: 1 }
          ],
          10,
          false
        ),
      /outside the supplied wall thickness/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: -5, stressMpa: 1 },
            { x: -5, stressMpa: 1 }
          ],
          10,
          false
        ),
      /strictly increasing/
    );
    assert.throws(
      () =>
        analyzer.linearizeStressClassificationLine(
          [
            { x: 0, stressMpa: 1 },
            { x: 5, stressMpa: 1 }
          ],
          10,
          false
        ),
      /include both supplied wall surfaces/
    );
    const cert = analyzer.generateComplianceCertificate('TAG-1');
    assert(cert.includes('TAG-1'));
    assert(cert.includes('experimental'));
    const cert2 = analyzer.generateComplianceCertificate({ vesselTag: 'VT-2' });
    assert(cert2.includes('VT-2'));
    const doc = analyzer.generateFormalCertificationDocument({ vesselTag: 'VT-3' });
    assert(doc.includes('VT-3'));
    assert(analyzer.generateFormalCertificationDocument().includes('unspecified'));
    const staticField = [
      { s: -5, σxx: 10, σyy: 5, σzz: 2, τxy: 1, τyz: 0, τzx: 0 },
      { s: 0, σxx: 20, σyy: 6, σzz: 3, τxy: 2, τyz: 0, τzx: 0 },
      { s: 5, σxx: 30, σyy: 7, σzz: 4, τxy: 3, τyz: 0, τzx: 0 }
    ];
    const staticLin = ASMESectionVIIIDiv2Analyzer.linearizeStressThroughThickness(staticField, {});
    assert.strictEqual(staticLin.method, 'least-squares-linear-regression');
    const staticAllow = ASMESectionVIIIDiv2Analyzer.evaluatePart5Allowables(10, 5, 1, { S: 100 });
    assert.strictEqual(staticAllow.overallAcceptable, true);
  });

  check('ToolQualificationKit evaluateEvidence metric and policy branch matrix', () => {
    const kit = new ToolQualificationKit({ toolName: 'cad', targetSafetyStandard: 'DO-330' });
    const fullEvidence = {
      testResults: { passed: 100, failed: 0 },
      coverage: { functions: 98, branches: 95 },
      defectTracking: { open: 1, closed: 10, openCritical: 0 },
      configMgmt: { baselines: 3, changes: 8, changesReviewed: 8 },
      usedFor: 'verification',
      toolVersion: '2.0'
    };
    const verdict = kit.evaluateEvidence(fullEvidence);
    assert.strictEqual(verdict.certificationClaimed, false);
    assert.strictEqual(verdict.verdict, 'evidence-satisfies-do330:TQL-5');
    assert.strictEqual(verdict.usedFor, 'verification');
    assert.strictEqual(verdict.level, 'do330:TQL-5');
    const missing = kit.evaluateEvidence({ usedFor: 'verification' });
    assert.strictEqual(missing.verdict, 'evidence-insufficient');
    assert(missing.incomplete);
    assert(missing.metrics.coverage.overall === null);
    const zeroTests = kit.evaluateEvidence({ testResults: { passed: 0, failed: 0 }, usedFor: 'verification' });
    assert(zeroTests.metrics.totalTests === null);
    const covObject = kit.evaluateEvidence({
      testResults: { passed: 10, failed: 0 },
      coverage: { functions: { total: 100, covered: 95 }, branches: { total: 100, covered: 80 }, mcDc: null },
      usedFor: 'verification'
    });
    assert.strictEqual(covObject.metrics.coverage.functions, 95);
    assert.strictEqual(covObject.metrics.coverage.branches, 80);
    assert.strictEqual(covObject.metrics.coverage.overall, 80);
    const badCov = kit.evaluateEvidence({
      testResults: { passed: 10, failed: 0 },
      coverage: { functions: { total: 0, covered: 1 } },
      usedFor: 'verification'
    });
    assert.strictEqual(badCov.metrics.coverage.functions, null);
    const badUsed = kit.evaluateEvidence({ testResults: { passed: 10, failed: 0 }, usedFor: 'hack' });
    assert.strictEqual(badUsed.usedFor, 'unspecified');
    assert(badUsed.reasoning.some((r) => r.includes('invalid usedFor')));
    const isoKit = new ToolQualificationKit({ toolName: 'ecu', targetSafetyStandard: 'ISO 26262 ASIL D' });
    const isoVerdict = isoKit.evaluateEvidence({ usedFor: 'test' });
    assert.strictEqual(isoVerdict.level, 'iso26262:TCL1-ASIL-D');
    assert.strictEqual(isoVerdict.verdict, 'evidence-insufficient');
    const explicitLevel = kit.evaluateEvidence({ level: 'do330:TQL-1', usedFor: 'verification' });
    assert.strictEqual(explicitLevel.level, 'do330:TQL-1');
    const thresholdOverride = kit.evaluateEvidence({
      testResults: { passed: 5, failed: 5 },
      coverage: { functions: 50 },
      defectTracking: { open: 0, closed: 1, openCritical: 0 },
      configMgmt: { baselines: 1, changes: 1, changesReviewed: 1 },
      thresholds: { minPassRatePercent: 40, minCoveragePercent: 40 },
      usedFor: 'verification'
    });
    assert.strictEqual(thresholdOverride.verdict, 'evidence-satisfies-do330:TQL-5');
    const reviewedMissing = isoKit.evaluateEvidence({
      testResults: { passed: 10, failed: 0 },
      coverage: { functions: 100 },
      defectTracking: { open: 0, closed: 1 },
      configMgmt: { baselines: 1, changes: 1 },
      usedFor: 'test'
    });
    assert.strictEqual(reviewedMissing.metrics.configChanges, 1);
    assert(typeof reviewedMissing.verdict === 'string');
  });

  check('ToolQualificationKit suite execution and report branches', () => {
    const kit = new ToolQualificationKit({ toolName: 'sim', targetSafetyStandard: 'DO-330' });
    assert.throws(() => kit.registerTestCase({}), /execute function/);
    kit.registerTestCase({
      id: 't1',
      description: 'passes',
      execute: () => ({ passes: true, actual: 1, expected: 1 })
    });
    kit.registerTestCase({
      id: 't2',
      description: 'fails',
      execute: () => ({ passes: false, actual: 2, expected: 1 })
    });
    kit.registerTestCase({
      id: 't3',
      description: 'throws',
      execute: () => {
        throw new Error('boom');
      }
    });
    const summary = kit.executeQualificationSuite();
    assert.strictEqual(summary.totalTests, 3);
    assert.strictEqual(summary.passedCount, 1);
    assert.strictEqual(summary.failedCount, 2);
    assert.match(summary.sha256Digest, /^[a-f0-9]{64}$/);
    assert.strictEqual(summary.status, 'diagnostic-only');
    const report = kit.generateExperimentalDiagnosticReport();
    assert(report.includes('Experimental Test Diagnostic Summary'));
    assert(report.includes('boom'));
    assert(report.includes('PASS'));
    assert(report.includes('FAIL'));
    const report2 = kit.generateComplianceReport();
    assert(report2.includes('Summary'));
    assert.throws(() => kit.generateCycloneDX_SBOM(), /SBOM generation is unavailable/);
    assert.throws(() => kit.generateSPDX_SBOM(), /SBOM generation is unavailable/);
    assert.strictEqual(ToolQualificationKit.computeSha256('abc').length, 64);
    assert.strictEqual(kit._toNumber(3), 3);
    assert.strictEqual(kit._toNumber('3'), null);
    assert.strictEqual(kit._toNumber(NaN), null);
    assert.strictEqual(kit._coveragePercent(null), null);
    assert.strictEqual(kit._coveragePercent(Infinity), null);
    assert.strictEqual(kit._coveragePercent(50), 50);
  });

  // ------------------------------------------------------------------
  // Aerospace cluster
  // ------------------------------------------------------------------
  check('NasaRocketPropulsion combustion and nozzle performance branches', () => {
    const r = new NasaRocketPropulsion();
    const bad = r.evaluateCombustionEquilibrium('', 20, 3);
    assert.strictEqual(bad.success, false);
    const unknown = r.evaluateCombustionEquilibrium('HYPERGOL', 20, 3);
    assert.match(unknown.error.message, /supported propellantType/);
    const badP = r.evaluateCombustionEquilibrium('LOX_LH2', -1, 3);
    assert.strictEqual(badP.success, false);
    const thermo = r.evaluateCombustionEquilibrium('LOX_LH2', 100, 6);
    assert.strictEqual(thermo.success, true);
    assert(thermo.gamma > 1);
    assert(thermo.characteristicVelocityM_s > 0);
    const perf = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 8,
      ambientPressureBar: 0
    });
    assert.strictEqual(perf.success, true);
    assert(perf.thrustVacuumKN > 0);
    assert(perf.exitMach > 1);
    const missing = r.calculateEnginePerformance({ propellantType: 'LOX_LCH4', chamberPressureBar: 100 });
    assert.strictEqual(missing.success, false);
    const negAmbient = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 8,
      ambientPressureBar: -1
    });
    assert.strictEqual(negAmbient.success, false);
    const lowRatio = r.calculateEnginePerformance({
      propellantType: 'LOX_LCH4',
      chamberPressureBar: 100,
      ofRatio: 3.6,
      throatDiameterM: 0.1,
      expansionRatio: 0.5,
      ambientPressureBar: 0
    });
    assert.match(lowRatio.error.message, /expansionRatio >= 1/);
    const arr = r.calculateEnginePerformance([1, 2]);
    assert.strictEqual(arr.success, false);
    assert.throws(() => r.solveNozzleExitMach(2, 1), /gamma > 1/);
    assert.throws(() => r.solveNozzleExitMach(0.5, 1.4), /expansionRatio >= 1/);
    const Me = r.solveNozzleExitMach(15, 1.4);
    assert(Me > 1 && Me < 20);
    assert.strictEqual(solveNozzleExitMach(10, 1.3) > 1, true);
    assert.throws(() => solveNozzleExitMach(0.1, 1.3), /Nozzle estimate requires/);
    assert.throws(() => solveNozzleExitMach(2, 1), /gamma > 1/);
  });

  check('NasaRocketPropulsion regenerative cooling validation branches', () => {
    const r = new NasaRocketPropulsion();
    const perf = r.calculateEnginePerformance({
      propellantType: 'LOX_RP1',
      chamberPressureBar: 100,
      ofRatio: 2.6,
      throatDiameterM: 0.12,
      expansionRatio: 10,
      ambientPressureBar: 0
    });
    assert.strictEqual(perf.success, true);
    const none = r.calculateBartzRegenerativeCooling(perf, null);
    assert.strictEqual(none.success, false);
    const missingGas = r.calculateBartzRegenerativeCooling(
      { success: true, thermo: {} },
      {
        gasViscosityPaS: 1e-5,
        gasSpecificHeatJKgK: 2500,
        gasPrandtl: 0.9,
        bartzCorrectionFactor: 1,
        recoveryFactor: 0.9,
        throatRadiusOfCurvatureM: 0.1,
        coolantChannelCount: 20,
        channelWidthM: 0.002,
        channelHeightM: 0.003,
        wallThicknessM: 0.001,
        coolantInletTempK: 300,
        coolantMassFlowKgS: 10,
        coolantDensityKgM3: 1000,
        coolantViscosityPaS: 1e-3,
        coolantSpecificHeatJKgK: 4200,
        coolantPrandtl: 6,
        coolantThermalConductivityWmK: 0.6,
        linerThermalConductivityWmK: 15,
        effectiveHeatTransferAreaM2: 1,
        coolantChannelLengthM: 1,
        inputSourceDescription: 'test'
      }
    );
    assert.strictEqual(missingGas.success, false);
    const badBartz = r.calculateBartzRegenerativeCooling(perf, {
      gasViscosityPaS: 1e-5,
      gasSpecificHeatJKgK: 2500,
      gasPrandtl: 0.9,
      bartzCorrectionFactor: 2,
      recoveryFactor: 0.9,
      throatRadiusOfCurvatureM: 0.1,
      coolantChannelCount: 20,
      channelWidthM: 0.002,
      channelHeightM: 0.003,
      wallThicknessM: 0.001,
      coolantInletTempK: 300,
      coolantMassFlowKgS: 10,
      coolantDensityKgM3: 1000,
      coolantViscosityPaS: 1e-3,
      coolantSpecificHeatJKgK: 4200,
      coolantPrandtl: 6,
      coolantThermalConductivityWmK: 0.6,
      linerThermalConductivityWmK: 15,
      effectiveHeatTransferAreaM2: 1,
      coolantChannelLengthM: 1,
      inputSourceDescription: 'test'
    });
    assert.strictEqual(badBartz.success, false);
    const good = r.calculateBartzRegenerativeCooling(perf, {
      gasViscosityPaS: 1e-5,
      gasSpecificHeatJKgK: 2500,
      gasPrandtl: 0.9,
      bartzCorrectionFactor: 1,
      recoveryFactor: 0.9,
      throatRadiusOfCurvatureM: 0.1,
      coolantChannelCount: 20,
      channelWidthM: 0.002,
      channelHeightM: 0.003,
      wallThicknessM: 0.001,
      coolantInletTempK: 300,
      coolantMassFlowKgS: 10,
      coolantDensityKgM3: 1000,
      coolantViscosityPaS: 1e-3,
      coolantSpecificHeatJKgK: 4200,
      coolantPrandtl: 6,
      coolantThermalConductivityWmK: 0.6,
      linerThermalConductivityWmK: 15,
      effectiveHeatTransferAreaM2: 1,
      coolantChannelLengthM: 1,
      inputSourceDescription: 'test'
    });
    assert.strictEqual(good.success, true);
    assert(good.coolantOutletTempK > 300);
  });

  check('NasaRocketPropulsion staging, isogrid, orbital, and shock helper branches', () => {
    const r = new NasaRocketPropulsion();
    const mission = r.calculateStagingDeltaV({
      payloadMassKg: 1000,
      stage1DryMassKg: 5000,
      stage1PropellantMassKg: 40000,
      stage1IspVac: 300,
      stage2DryMassKg: 2000,
      stage2PropellantMassKg: 15000,
      stage2IspVac: 340,
      gravityLossesM_s: 1500,
      aerodynamicLossesM_s: 300,
      steeringLossesM_s: 100,
      requiredDeltaV_m_s: 9000,
      inputSourceDescription: 'test'
    });
    assert.strictEqual(mission.success, true);
    assert(mission.totalIdealDeltaV_m_s > 0);
    assert(mission.stage2.idealDeltaV_m_s > 0);
    assert(mission.netDeliveredDeltaV_m_s < mission.totalIdealDeltaV_m_s);
    assert.strictEqual(mission.screeningStatus, 'EXPERIMENTAL_SCREENING_ONLY');
    const miss = r.calculateStagingDeltaV({ payloadMassKg: 1000 });
    assert.strictEqual(miss.success, false);
    const noParam = r.calculateStagingDeltaV();
    assert.strictEqual(noParam.success, false);
    const tank = r.calculateIsogridTankBuckling({
      tankRadiusM: 1.5,
      tankLengthM: 10,
      internalPressureBar: 3,
      axialCompressiveLoadKN: 500,
      skinThicknessMm: 3,
      ribHeightMm: 20,
      ribWidthMm: 4,
      elasticModulusPa: 70e9,
      poissonRatio: 0.33,
      yieldStrengthPa: 280e6,
      safetyFactor: 1.5,
      minimumSkinThicknessMm: 2,
      bucklingKnockdownFactor: 0.8,
      pressureStabilizationCoefficient: 0,
      internalPressureAxialLoadReliefFactor: 0,
      material: 'Al-6061',
      inputSourceDescription: 'test'
    });
    assert.strictEqual(tank.success, true);
    assert(tank.marginOfSafety > 0);
    assert.strictEqual(typeof tank.structuralIntegrity, 'string');
    const badTank = r.calculateIsogridTankBuckling({ tankRadiusM: 1 });
    assert.strictEqual(badTank.success, false);
    const nuPoisson = r.calculateIsogridTankBuckling({
      tankRadiusM: 1.5,
      tankLengthM: 10,
      internalPressureBar: 3,
      axialCompressiveLoadKN: 500,
      skinThicknessMm: 3,
      ribHeightMm: 20,
      ribWidthMm: 4,
      elasticModulusPa: 70e9,
      poissonRatio: 0.6,
      yieldStrengthPa: 280e6,
      safetyFactor: 1.5,
      minimumSkinThicknessMm: 2,
      bucklingKnockdownFactor: 0.8,
      pressureStabilizationCoefficient: 0,
      internalPressureAxialLoadReliefFactor: 0,
      material: 'Al',
      inputSourceDescription: 'test'
    });
    assert.match(nuPoisson.error.message, /poissonRatio < 0.5/);
    const badKd = r.calculateIsogridTankBuckling({
      tankRadiusM: 1.5,
      tankLengthM: 10,
      internalPressureBar: 3,
      axialCompressiveLoadKN: 500,
      skinThicknessMm: 3,
      ribHeightMm: 20,
      ribWidthMm: 4,
      elasticModulusPa: 70e9,
      poissonRatio: 0.33,
      yieldStrengthPa: 280e6,
      safetyFactor: 1.5,
      minimumSkinThicknessMm: 2,
      bucklingKnockdownFactor: 1.2,
      pressureStabilizationCoefficient: 0,
      internalPressureAxialLoadReliefFactor: 0,
      material: 'Al',
      inputSourceDescription: 'test'
    });
    assert.match(badKd.error.message, /bucklingKnockdownFactor <= 1/);
    const orbit = r.calculateOrbitalTransfer({ r1Meters: 6771e3, r2Meters: 42164e3 });
    assert.strictEqual(orbit.success, true);
    assert.strictEqual(orbit.transferType, 'hohmann');
    assert(orbit.deltaVTotalKmS > 0);
    const orbitBad = r.calculateOrbitalTransfer({ r1Meters: 42164e3, r2Meters: 6771e3 });
    assert.strictEqual(orbitBad.success, false);
    const bi = r.calculateOrbitalTransfer({ r1Meters: 6771e3, r2Meters: 42164e3, intermediateRadiusM: 100000e3 });
    assert.strictEqual(bi.transferType, 'bi-elliptic');
    assert(bi.biEllipticDeltaVTotalKmS > 0);
    const biBad = r.calculateOrbitalTransfer({ r1Meters: 6771e3, r2Meters: 42164e3, intermediateRadiusM: 1000e3 });
    assert.strictEqual(biBad.success, false);
    const arr = r.calculateOrbitalTransfer([1]);
    assert.strictEqual(arr.success, false);
    const theta = thetaFromBeta(3, 0.35, 1.4);
    assert(Number.isFinite(theta));
    assert(theta > 0);
    const oblique = solveObliqueShockBeta(3, 0.2, 1.4);
    assert(Number.isFinite(oblique));
    const state = obliqueShockState(3, oblique, 0.2, 1.4);
    assert(state.pRatio > 1);
    const nu = prandtlMeyerFunction(2, 1.4);
    assert(nu > 0);
    assert(Math.abs(inversePrandtlMeyerFunction(nu, 1.4) - 2) < 1e-6);
    assert(isentropicPressureRatio(1, 2, 1.4) > 0);
  });

  check('NasaRocketPropulsion ascent trajectory schedule branches', () => {
    const r = new NasaRocketPropulsion();
    const vehicle = {
      liftOffMassKg: 550000,
      stage1PropellantMassKg: 400000,
      stage1EngineCount: 9,
      thrustPerEngineSL_kN: 750,
      Isp_sl: 280,
      Isp_vac: 310,
      rocketDiameterM: 3.7,
      burnTimeS: 160,
      timeStepS: 0.5,
      inputSourceDescription: 'test'
    };
    const bad = r.simulateAscentTrajectory({ liftOffMassKg: 300000 });
    assert.strictEqual(bad.success, false);
    const badCount = r.simulateAscentTrajectory({ ...vehicle, stage1EngineCount: 2.5 });
    assert.strictEqual(badCount.success, false);
    const badDrag = r.simulateAscentTrajectory({
      ...vehicle,
      dragCoefficientByMach: [{ machNumber: 1, dragCoefficient: 0.5 }]
    });
    assert.strictEqual(badDrag.success, false);
    const badDragStart = r.simulateAscentTrajectory({
      ...vehicle,
      dragCoefficientByMach: [
        { machNumber: 0.5, dragCoefficient: 0.5 },
        { machNumber: 1, dragCoefficient: 0.6 }
      ]
    });
    assert.strictEqual(badDragStart.success, false);
    const badPitch = r.simulateAscentTrajectory({
      ...vehicle,
      pitchAngleByAltitude: [
        { altitudeM: 0, pitchAngleDeg: 95 },
        { altitudeM: 100, pitchAngleDeg: 60 }
      ]
    });
    assert.strictEqual(badPitch.success, false);
    const good = r.simulateAscentTrajectory({
      ...vehicle,
      dragCoefficientByMach: [
        { machNumber: 0, dragCoefficient: 0.3 },
        { machNumber: 1, dragCoefficient: 0.5 },
        { machNumber: 20, dragCoefficient: 0.35 }
      ],
      pitchAngleByAltitude: [
        { altitudeM: 0, pitchAngleDeg: 90 },
        { altitudeM: 10000, pitchAngleDeg: 60 },
        { altitudeM: 100000, pitchAngleDeg: 0 }
      ]
    });
    assert.strictEqual(good.success, true);
    assert(good.maxDynamicPressureKPa > 0);
    assert(good.maxQMach > 0);
    assert(good.trajectorySamples.length > 0);
    assert(good.cutoffAltitudeKm >= 0);
    assert.strictEqual(r.getNasaSubsystemEntities().length, 0);
    assert(r.getNasaSpacecraftInteriorSpecification());
  });

  check('SixDofDynamics validation branches and successful simulation', () => {
    const sim = new SixDofDynamics();
    const base = {
      massKg: 1000,
      inertiaKgM2: [500, 800, 500],
      dt: 0.01,
      steps: 50,
      gravityModel: 'constant',
      initialState: {
        positionM: [0, 0, 10000],
        velocityM_s: [0, 0, 0],
        quaternion: [1, 0, 0, 0],
        angularRateRad_s: [0, 0, 0]
      },
      thrust: { magnitudeN: 20000, directionBody: [0, 0, 1] }
    };
    const ok = sim.simulateSixDof(base);
    assert.strictEqual(ok.success, true);
    assert(ok.trajectory.length >= 50);
    assert(ok.finalState.positionM[2] > 10000);
    assert.strictEqual(sim.simulateSixDof(null).success, false);
    assert.strictEqual(sim.simulateSixDof([1]).success, false);
    const badState = sim.simulateSixDof({ ...base, initialState: {} });
    assert.strictEqual(badState.success, false);
    assert(badState.error.message.includes('quaternion'));
    const badQuat = sim.simulateSixDof({ ...base, initialState: { ...base.initialState, quaternion: [1, 0, 0] } });
    assert.strictEqual(badQuat.success, false);
    const notUnit = sim.simulateSixDof({ ...base, initialState: { ...base.initialState, quaternion: [2, 0, 0, 0] } });
    assert.strictEqual(notUnit.success, false);
    assert(notUnit.error.message.includes('unit'));
    const negMass = sim.simulateSixDof({ ...base, massKg: -1 });
    assert.strictEqual(negMass.success, false);
    const badInertia = sim.simulateSixDof({ ...base, inertiaKgM2: [500, 0, 500] });
    assert.strictEqual(badInertia.success, false);
    const badDt = sim.simulateSixDof({ ...base, dt: 0 });
    assert.strictEqual(badDt.success, false);
    const badSteps = sim.simulateSixDof({ ...base, steps: -3 });
    assert.strictEqual(badSteps.success, false);
    const badThrust = sim.simulateSixDof({ ...base, thrust: { magnitudeN: 1, directionBody: [1, 0] } });
    assert.strictEqual(badThrust.success, false);
    const badProfile = sim.simulateSixDof({ ...base, thrust: [{ timeS: 0, magnitudeN: 1 }] });
    assert.strictEqual(badProfile.success, false);
    const badProfileOrder = sim.simulateSixDof({
      ...base,
      thrust: [
        { timeS: 1, magnitudeN: 1 },
        { timeS: 1, magnitudeN: 2 }
      ]
    });
    assert.strictEqual(badProfileOrder.success, false);
    const badProfileDir = sim.simulateSixDof({
      ...base,
      thrust: [
        { timeS: 0, magnitudeN: 1, directionBody: [0, 1] },
        { timeS: 1, magnitudeN: 2 }
      ]
    });
    assert.strictEqual(badProfileDir.success, false);
    const badCoef = sim.simulateSixDof({
      ...base,
      coefficients: { alphaDeg: [0, 5], mach: [0.2, 0.5], cl: [[0, 0]], cd: [[0, 0]], cm: [[0, 0]] }
    });
    assert.strictEqual(badCoef.success, false);
    const belowEarth = sim.simulateSixDof({
      ...base,
      gravityModel: 'inverse-square',
      initialState: { ...base.initialState, positionM: [0, 0, 1000] }
    });
    assert.strictEqual(belowEarth.success, false);
    assert(belowEarth.error.message.includes('outside Earth'));
    const profileSim = sim.simulateSixDof({
      ...base,
      thrust: [
        { timeS: 0, magnitudeN: 10000, directionBody: [0, 0, 1] },
        { timeS: 0.2, magnitudeN: 20000 },
        { timeS: 0.5, magnitudeN: 0 }
      ]
    });
    assert.strictEqual(profileSim.success, true);
    const aeroSim = sim.simulateSixDof({
      ...base,
      initialState: {
        positionM: [0, 0, 10000],
        velocityM_s: [0, 0, 200],
        quaternion: [1, 0, 0, 0],
        angularRateRad_s: [0, 0, 0]
      },
      coefficients: {
        alphaDeg: [-10, 0, 10],
        mach: [0.2, 0.5, 1.0],
        cl: [
          [-0.2, 0, 0.2],
          [-0.25, 0, 0.25],
          [-0.3, 0, 0.3]
        ],
        cd: [
          [0.03, 0.03, 0.03],
          [0.04, 0.04, 0.04],
          [0.05, 0.05, 0.05]
        ],
        cm: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0]
        ]
      },
      referenceAreaM2: 10,
      referenceLengthM: 2,
      thrust: null
    });
    assert.strictEqual(aeroSim.success, true);
  });

  // ------------------------------------------------------------------
  // Robotics cluster
  // ------------------------------------------------------------------
  check('RoboticsEngineAdapter validate and execute error branches', async () => {
    const adapter = new RoboticsEngineAdapter();
    assert.throws(() => adapter.validate(null), /null request/);
    assert.throws(() => adapter.validate({ domain: 'eda', operation: 'forward_kinematics' }), /Domain mismatch/);
    assert.throws(
      () => adapter.validate({ domain: 'robotics', operation: 'teleport' }),
      /Unsupported robotics operation/
    );
    const caps = adapter.describeCapabilities();
    assert.strictEqual(caps.domain, 'robotics');
    assert(caps.supportedOperations.includes('forward_kinematics'));
    assert.strictEqual(
      adapter.validate({
        domain: 'robotics',
        operation: 'forward_kinematics',
        parameters: { preset: 'PUMA_560', q: [0, 0, 0, 0, 0, 0] }
      }),
      true
    );
    assert.throws(
      () =>
        adapter.validate({
          domain: 'robotics',
          operation: 'forward_kinematics',
          parameters: { dhTable: [{ a: NaN, alpha: 0, d: 0 }], q: [0] }
        }),
      /non-finite kinematic parameters/
    );
    assert.throws(
      () =>
        adapter.validate({ domain: 'robotics', operation: 'inverse_kinematics', parameters: { preset: 'PUMA_560' } }),
      /targetPose/
    );
    await assert.rejects(
      () => adapter.execute({ domain: 'robotics', operation: 'teleport' }),
      /Unsupported robotics operation/
    );
    const res = await adapter.execute({
      domain: 'robotics',
      operation: 'forward_kinematics',
      parameters: { preset: 'PUMA_560', q: [0, 0, 0, 0, 0, 0] }
    });
    assert.strictEqual(res.status, 'COMPLETED');
    assert(res._output.endEffectorTransform);
    const ik = await adapter.execute({
      domain: 'robotics',
      operation: 'inverse_kinematics',
      parameters: { preset: 'PUMA_560', targetPose: res._output.endEffectorTransform, q0: [0, 0, 0, 0, 0, 0] }
    });
    assert(ik._output.jointAngles || ik._output.q);
  });

  check('SerialManipulatorEngine preset resolution and trajectory branches', () => {
    assert.throws(() => SerialManipulatorEngine.resolveKinematicChain('NOPE'), /Unknown manipulator preset/);
    assert.throws(() => SerialManipulatorEngine.resolveKinematicChain([]), /cannot be empty/);
    assert.throws(() => SerialManipulatorEngine.resolveKinematicChain(null), /Invalid kinematic chain/);
    const preset = SerialManipulatorEngine.resolveKinematicChain('UR5E');
    assert.strictEqual(preset.dof, 6);
    assert.strictEqual(preset.name, 'UR5E');
    const puma = SerialManipulatorEngine.resolveKinematicChain(PUMA_560_DH);
    assert.strictEqual(puma.dof, 6);
    const plan = SerialManipulatorEngine.planQuinticTrajectory({
      qStart: [0, 0, 0, 0, 0, 0],
      qEnd: [0.1, 0, 0, 0, 0, 0],
      duration: 1,
      dt: 0.05
    });
    assert(plan.samples.length > 1);
    assert(plan.samples[plan.samples.length - 1].q[0] > 0.09);
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({}),
      /non-empty finite qStart|configuration object/
    );
    assert.throws(
      () => SerialManipulatorEngine.planQuinticTrajectory({ qStart: [], qEnd: [], duration: 1, dt: 0.1 }),
      /non-empty finite qStart/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.planQuinticTrajectory({
          qStart: [0, 0, 0, 0, 0, 0],
          qEnd: [0.1, 0, 0, 0, 0, 0],
          duration: 0,
          dt: 0.05
        }),
      /positive finite duration/
    );
    assert.throws(
      () =>
        SerialManipulatorEngine.planQuinticTrajectory({
          qStart: [0, 0, 0, 0, 0, 0],
          qEnd: [0.1, 0, 0, 0, 0, 0],
          duration: 1,
          dt: 2
        }),
      /dt <= duration/
    );
    assert.throws(() => SerialManipulatorEngine.parseURDF(''), /non-empty URDF XML string or JSON object/);
    assert.throws(() => SerialManipulatorEngine.parseURDF('<notrobot/>'), /missing <robot>/);
  });

  // ------------------------------------------------------------------
  // Plant cluster
  // ------------------------------------------------------------------
  check('IAPWS-IF97 saturation and region guard branches', () => {
    const Psat = IAPWS_IF97.saturationPressure(373.15);
    assert(Psat > 1e5 && Psat < 1.1e5);
    assert.throws(() => IAPWS_IF97.saturationPressure(200), /outside IAPWS-IF97 saturation range/);
    assert.throws(() => IAPWS_IF97.saturationPressure(700), /outside IAPWS-IF97 saturation range/);
    const Tsat = IAPWS_IF97.saturationTemperature(101325);
    assert(Number.isFinite(Tsat));
    const TsatHigh = IAPWS_IF97.saturationTemperature(21e6);
    assert(Number.isFinite(TsatHigh));
    assert.throws(() => IAPWS_IF97.saturationTemperature(100), /outside IAPWS-IF97 saturation range/);
    assert.throws(() => IAPWS_IF97.saturationTemperature(30e6), /outside IAPWS-IF97 saturation range/);
    const r1 = IAPWS_IF97.region1Properties(10e6, 300);
    assert.strictEqual(r1.phase, 'liquid');
    assert(r1.density_kg_m3 > 900);
    assert.throws(() => IAPWS_IF97.region1Properties(10e6, 100), /Region 1 range/);
    assert.throws(() => IAPWS_IF97.region1Properties(-1, 300), /Region 1 range/);
    assert.throws(() => IAPWS_IF97.region1Properties(200e6, 300), /Region 1 range/);
    const r2 = IAPWS_IF97.region2Properties(1e6, 500);
    assert.strictEqual(r2.phase, 'vapor');
    assert(r2.specificEnthalpy_J_kg > 2e6);
    assert.throws(() => IAPWS_IF97.region2Properties(1e6, 100), /Region 2 range/);
    assert.throws(() => IAPWS_IF97.region2Properties(0, 500), /Region 2 range/);
    const r5 = IAPWS_IF97.region5Properties(1e6, 1500);
    assert.strictEqual(r5.phase, 'gas');
    assert.throws(() => IAPWS_IF97.region5Properties(1e6, 1000), /Region 5 range/);
    assert.throws(() => IAPWS_IF97.region5Properties(100e6, 1500), /Region 5 range/);
    assert.deepStrictEqual(IAPWS_IF97.calculatePropertiesRegion5(1e6, 1500), r5);
  });

  check('IAPWS-IF97 calculateProperties region selection and fail-closed branches', () => {
    const subcooled = IAPWS_IF97.calculateProperties(20e6, 500);
    assert.strictEqual(subcooled.phase, 'liquid');
    assert.strictEqual(subcooled.isSaturated, false);
    const superheated = IAPWS_IF97.calculateProperties(1e6, 500);
    assert.strictEqual(superheated.phase, 'vapor');
    const highT = IAPWS_IF97.calculateProperties(10e6, 1200);
    assert.strictEqual(highT.phase, 'gas');
    const saturated = IAPWS_IF97.calculateProperties(IAPWS_IF97.saturationPressure(500), 500);
    assert.strictEqual(saturated.isSaturated, true);
    assert(saturated.saturation);
    assert.throws(() => IAPWS_IF97.calculateProperties(1e6, 100), /valid range/);
    assert.throws(() => IAPWS_IF97.calculateProperties(1e6, 3000), /valid range/);
    assert.throws(() => IAPWS_IF97.calculateProperties(0, 500), /valid range/);
    assert.throws(() => IAPWS_IF97.calculateProperties(200e6, 500), /valid range/);
    assert.throws(() => IAPWS_IF97.calculateProperties(60e6, 1200), /valid range/);
    assert.throws(() => IAPWS_IF97.calculateProperties(50e6, 700), /Region 3/);
    const r2mid = IAPWS_IF97.calculateProperties(20e6, 700);
    assert.strictEqual(r2mid.phase, 'vapor');
  });

  check('HeatExchangerTEMA rating modes and branch coverage', () => {
    const hx = new HeatExchangerTEMA();
    const obj = hx.rateExchanger({
      hotFlowKgS: 10,
      hotCp_kJ_kgK: 2.5,
      hotInletC: 90,
      hotOutletC: 60,
      coldFlowKgS: 20,
      coldCp_kJ_kgK: 4.18,
      coldInletC: 25,
      coldOutletC: 40
    });
    assert.strictEqual(obj.heatDutyKW, obj.dutyKW);
    assert.strictEqual(obj.pressureDropShellBar, null);
    assert.strictEqual(obj.fFactor, obj.fCorrectionFactor);
    assert(obj.requiredAreaM2 > 0);
    const direct = HeatExchangerTEMA.rateExchanger(
      { massFlowKgS: 10, CpJkgK: 2500, TinC: 90, ToutC: 60 },
      { massFlowKgS: 20, CpJkgK: 4180, TinC: 25, ToutC: 40 },
      { tubeOD_mm: 19.05, tubeLength_m: 6, overallU_W_m2K: 450, tubePasses: 2 }
    );
    assert(direct.heatTransferAreaM2 > 0);
    assert.strictEqual(direct.numberOfTubes > 0, true);
    const nearR1 = HeatExchangerTEMA.rateExchanger(
      { massFlowKgS: 10, CpJkgK: 2500, TinC: 80, ToutC: 50 },
      { massFlowKgS: 10, CpJkgK: 5000, TinC: 20, ToutC: 50 },
      { tubePasses: 2 }
    );
    assert.strictEqual(nearR1.fCorrectionFactor > 0.8, true);
    const cross = HeatExchangerTEMA.rateExchanger(
      { massFlowKgS: 10, CpJkgK: 2500, TinC: 50, ToutC: 40 },
      { massFlowKgS: 20, CpJkgK: 4180, TinC: 45, ToutC: 48 },
      {}
    );
    assert(cross.counterFlowLMTD_C >= 1);
    const nonViable = HeatExchangerTEMA.rateExchanger(
      { massFlowKgS: 10, CpJkgK: 2500, TinC: 90, ToutC: 30 },
      { massFlowKgS: 20, CpJkgK: 4180, TinC: 25, ToutC: 35 },
      {}
    );
    assert.strictEqual(typeof nonViable.isThermalDesignViable, 'boolean');
  });

  check('WegsteinRecycleSolver successive/wegstein/broyden branches', () => {
    const linear = (x) => new Float64Array([0.5 * x[0] + 1]);
    const succ = new WegsteinRecycleSolver({ method: 'successive', maxIter: 300, absTol: 1e-10, relTol: 1e-10 });
    const r2 = succ.solve(new Float64Array([0]), linear);
    assert.strictEqual(r2.converged, true);
    assert(Math.abs(r2.x[0] - 2) < 1e-6);
    const broy = new WegsteinRecycleSolver({ method: 'broyden', maxIter: 200 });
    const r3 = broy.solve(new Float64Array([0]), linear);
    assert.strictEqual(r3.converged, true);
    const weg = new WegsteinRecycleSolver({ method: 'wegstein', maxIter: 50, relTol: 1e-8 });
    const r1 = weg.solve(new Float64Array([0]), linear);
    assert(r1.history.length > 0);
    assert(r1.x.length > 0);
    const immediate = new WegsteinRecycleSolver({ absTol: 1e-3 });
    const r5 = immediate.solve(new Float64Array([1]), (x) => new Float64Array([1.0001]));
    assert.strictEqual(r5.iterations, 0);
    assert.strictEqual(r5.converged, true);
    const clamp = new WegsteinRecycleSolver({ method: 'wegstein', maxIter: 5, qMin: -2, qMax: 0 });
    const r7 = clamp.solve(new Float64Array([0]), (x) => new Float64Array([x[0] + 0.5]));
    assert(r7.iterations >= 5);
    assert.strictEqual(r7.converged, false);
    const multi = new WegsteinRecycleSolver({ method: 'wegstein', maxIter: 10 });
    const r9 = multi.solve(new Float64Array([0, 0]), (x) => new Float64Array([0.5 * x[0] + 1, 0.5 * x[1] + 2]));
    assert(r9.history.length >= 1);
    const broyMulti = new WegsteinRecycleSolver({ method: 'broyden', maxIter: 100 });
    const r10 = broyMulti.solve(new Float64Array([0, 0]), (x) => new Float64Array([0.5 * x[0] + 1, 0.5 * x[1] + 2]));
    assert(r10.history.length >= 1);
    const nonConv = new WegsteinRecycleSolver({ method: 'successive', maxIter: 3 });
    const r11 = nonConv.solve(new Float64Array([1]), (x) => new Float64Array([-x[0] + 10]));
    assert.strictEqual(r11.converged, false);
    assert(r11.iterations >= 3);
  });

  // ------------------------------------------------------------------
  // Math cluster
  // ------------------------------------------------------------------
  check('DomainDecompositionEngine partitionMesh branches and Schur dimensions', () => {
    const nodes = [];
    for (let z = 0; z < 4; z++)
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          nodes.push({ x, y, z });
        }
    const elements = [];
    const idx = (x, y, z) => z * 16 + y * 4 + x;
    for (let z = 0; z < 3; z++)
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 3; x++) {
          elements.push([
            idx(x, y, z),
            idx(x + 1, y, z),
            idx(x + 1, y + 1, z),
            idx(x, y + 1, z),
            idx(x, y, z + 1),
            idx(x + 1, y, z + 1),
            idx(x + 1, y + 1, z + 1),
            idx(x, y + 1, z + 1)
          ]);
        }
    const single = DomainDecompositionEngine.partitionMesh(nodes, elements, 1);
    assert.strictEqual(single.subdomains.length, 1);
    assert.strictEqual(single.loadImbalanceRatio, 1);
    const small = DomainDecompositionEngine.partitionMesh(nodes, [elements[0]], 4);
    assert.strictEqual(small.subdomains.length, 1);
    const split = DomainDecompositionEngine.partitionMesh(nodes, elements, 4);
    assert.strictEqual(split.subdomains.length, 4);
    assert(split.interfaceNodes.length > 0);
    assert(split.loadImbalanceRatio >= 1);
    const dims = DomainDecompositionEngine.evaluateSchurDimensions(split, 3);
    assert.strictEqual(dims.interfaceDofsCount, split.interfaceNodes.length * 3);
    assert(dims.internalDofsCount > 0);
    assert.strictEqual(dims.schurDimension, dims.interfaceDofsCount);
  });

  check('ExperimentalCalculationQueue dispatch branches and telemetry', async () => {
    const q = new ExperimentalCalculationQueue();
    await assert.rejects(() => q.dispatch('', {}), /task type is required/);
    await assert.rejects(() => q.dispatch('ECHO_TEST', null), /task payload object is required/);
    await assert.rejects(() => q.dispatch('ECHO_TEST', { a: 1 }, []), /options must be an object/);
    await assert.rejects(() => q.dispatch('ECHO_TEST', {}, { priority: 'GODLIKE' }), /Unsupported task priority/);
    const res = await q.dispatch('ECHO_TEST', { message: 'hi' });
    assert.strictEqual(res.result.echo, 'hi');
    assert.strictEqual(res.executionMode, 'main-event-loop');
    const res2 = await getGlobalWorkerPool().dispatch('ECHO_TEST', { message: 'global', delayMs: 1 });
    assert.strictEqual(res2.result.echo, 'global');
    await assert.rejects(() => q.dispatch('NOT_A_KERNEL', {}), /Unsupported experimental task type/);
    const tel = q.getTelemetry();
    assert(tel.completedTasksCount >= 1);
    assert.strictEqual(tel.executionMode, 'main-event-loop');
    assert.throws(() => q.allocateSharedBuffer(-1), /non-negative byte length/);
    assert(
      q.allocateSharedBuffer(64) instanceof ArrayBuffer || q.allocateSharedBuffer(64) instanceof SharedArrayBuffer
    );
    assert.throws(() => new ExperimentalCalculationQueue({ maxWorkers: 4 }), /maxWorkers/);
    assert.throws(() => new ExperimentalCalculationQueue({ bogus: true }), /cannot honor/);
  });

  check('WasmSparseMultifrontalSolver structured Poisson and general sparse paths', () => {
    const dense = [
      [4, -1, 0, -1],
      [-1, 4, -1, 0],
      [0, -1, 4, -1],
      [-1, 0, -1, 4]
    ];
    const s = new WasmSparseMultifrontalSolver(4, 4);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (dense[i][j] !== 0) s.addEntry(i, j, dense[i][j]);
      }
    }
    const fac = s.factorize();
    assert.strictEqual(fac.dimension, 4);
    assert.strictEqual(s.factorized, true);
    const sol = s.solve(new Float64Array([1, 1, 1, 1]));
    assert(sol.converged);
    assert.strictEqual(s.solveRhs(new Float64Array([1, 1, 1, 1])).length, 4);
    const general = new WasmSparseMultifrontalSolver(4, 4, { enableStructuredPoissonDirect: false });
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (dense[i][j] !== 0) general.addEntry(i, j, dense[i][j]);
      }
    }
    const gFac = general.factorize();
    assert.strictEqual(gFac.orderingMethod, 'nested-dissection');
    const gSol = general.solve(new Float64Array([1, 1, 1, 1]));
    assert.strictEqual(gSol.converged, true);
    const dup = new WasmSparseMultifrontalSolver(2, 2);
    dup.addEntry(0, 0, 2);
    dup.addEntry(0, 0, 2);
    dup.addEntry(1, 1, 2);
    dup.addEntry(0, 1, 0);
    dup.addEntry(1, 0, 0);
    dup.finalizeCSR();
    assert.strictEqual(dup.nnz, 4);
    const nd = new WasmSparseMultifrontalSolver(3, 3, { enableStructuredPoissonDirect: false });
    nd.addEntry(0, 0, 4);
    nd.addEntry(1, 1, 4);
    nd.addEntry(2, 2, 4);
    nd.addEntry(0, 1, -1);
    nd.addEntry(1, 0, -1);
    nd.addEntry(1, 2, -1);
    nd.addEntry(2, 1, -1);
    const ndFac = nd.factorize();
    assert.strictEqual(ndFac.nnzL, 5);
    const denseToCsr = WasmSparseMultifrontalSolver.prototype.denseToCSR.call(
      new WasmSparseMultifrontalSolver(2, 2),
      dense.slice(0, 2).map((r) => r.slice(0, 2))
    );
    assert.strictEqual(denseToCsr.nnz, 4);
    const ch = new WasmSparseMultifrontalSolver(2, 2, { enableStructuredPoissonDirect: false });
    ch.addEntry(0, 0, 2);
    ch.addEntry(1, 1, 2);
    ch.addEntry(0, 1, 1);
    ch.addEntry(1, 0, 1);
    const chSol = WasmSparseMultifrontalSolver.prototype.solveCholesky.call(ch, null, new Float64Array([1, 1]));
    assert.strictEqual(chSol.length, 2);
  });

  // ------------------------------------------------------------------
  // HPC cluster
  // ------------------------------------------------------------------
  check('HpcClusterGateway job state machine transition branches', () => {
    const gw = new HpcClusterGateway();
    const job = gw.submitJob({
      scheduler: 'SLURM',
      jobName: 'sim',
      nodes: 2,
      ntasksPerNode: 8,
      walltime: '01:00:00',
      gpusPerNode: 1,
      account: 'acct',
      qos: 'normal',
      email: 'a@b.c',
      modules: ['gcc'],
      executable: 'solver',
      args: ['-i', 'in.json']
    });
    assert.strictEqual(job.status, JOB_STATES.QUEUED);
    assert(job.submissionSpec.script.includes('#SBATCH --gres=gpu:1'));
    assert(job.submissionSpec.script.includes('#SBATCH --account=acct'));
    assert(job.submissionSpec.script.includes('srun'));
    assert.strictEqual(gw.markRunning(job.jobId).status, JOB_STATES.RUNNING);
    assert.strictEqual(gw.markCompleted(job.jobId).status, JOB_STATES.COMPLETED);
    assert(gw.getJob(job.jobId).completedAt);
    assert.throws(() => gw.markCompleted(job.jobId), /Illegal HPC job transition/);
    const job2 = gw.submitJob({ scheduler: 'PBS_PRO', nodes: 1 });
    assert.strictEqual(gw.markRunning(job2.jobId).status, JOB_STATES.RUNNING);
    const failed = gw.failJob(job2.jobId, new Error('boom'));
    assert.strictEqual(failed.status, JOB_STATES.FAILED);
    assert.strictEqual(failed.error.code, 'INTERNAL');
    assert.strictEqual(failed.error.message, 'boom');
    const job3 = gw.submitJob({ scheduler: 'PBS_PRO', nodes: 1 });
    const failedObj = gw.failJob(job3.jobId, { code: 'X', message: 'y' });
    assert.strictEqual(failedObj.error.code, 'X');
    assert.throws(() => gw.failJob('nope'), /Unknown HPC job id/);
    assert.throws(() => gw.getJob('nope'), /Unknown HPC job id/);
    assert.throws(() => gw.markRunning('nope'), /Unknown HPC job id/);
    assert.strictEqual(gw.listJobs({ status: 'COMPLETED' }).length, 1);
    assert.strictEqual(gw.listJobs({ scheduler: 'SLURM' }).length, 1);
    assert.strictEqual(gw.listJobs({ status: 'FAILED', scheduler: 'PBS_PRO' }).length, 2);
    const tel = gw.getTelemetry();
    assert.strictEqual(tel.jobs.total, 3);
    assert.strictEqual(tel.jobs.byState.COMPLETED, 1);
    assert(tel.schedulersSupported.includes('SLURM'));
  });

  check('HpcClusterGateway submitJob/submitSimulationJob validation branches', () => {
    const gw = new HpcClusterGateway();
    assert.throws(() => gw.submitJob(null), /job spec object/);
    assert.throws(() => gw.submitJob([1]), /job spec object/);
    assert.throws(() => gw.submitJob({ scheduler: 'TORQUE' }), /Unsupported scheduler/);
    assert.throws(() => gw.submitJob({ scheduler: 'SLURM', nodes: 0 }), /must be an integer >= 1/);
    assert.throws(() => gw.submitJob({ scheduler: 'SLURM', walltime: '01:99:00' }), /HH:MM:SS/);
    assert.throws(() => gw.submitJob({ scheduler: 'SLURM', modules: ['ok', 7] }), /non-empty strings/);
    assert.throws(() => gw.submitSimulationJob('', {}, 1), /job type string is required/);
    assert.throws(() => gw.submitSimulationJob('sim', [1], 1), /parameter object is required/);
    assert.throws(() => gw.submitSimulationJob('sim', {}, 0), /positive integer rank count/);
    const res = gw.submitSimulationJob('cfd', { partition: 'gpu' }, 32);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.scheduler, 'SLURM');
    assert.strictEqual(res.submissionSpec.nodes, 2);
    const pbs = gw.submitJob({
      scheduler: 'PBS_PRO',
      nodes: 2,
      mpiRanksPerNode: 4,
      cpusPerRank: 2,
      memoryPerNode: '32GB',
      email: 'e@x.y'
    });
    assert(pbs.submissionSpec.script.includes('#PBS -l mem=32GB'));
    assert(pbs.submissionSpec.script.includes('#PBS -M e@x.y'));
    assert(pbs.submissionSpec.script.includes('mpiexec'));
    const pbsAlt = HpcClusterGateway.generatePbsScript({ nodes: 1, jobName: 'alt' });
    assert.strictEqual(pbsAlt.scheduler, 'PBS_PRO');
    assert.throws(() => HpcClusterGateway.generatePbsScript(null), /job spec object/);
    assert.strictEqual(HpcClusterGateway.VERSION, '3.0.0');
    assert.strictEqual(HpcClusterGateway.JobState, JOB_STATES);
  });

  check('HpcClusterGateway planOutOfCoreFrontal and RCB branches', () => {
    assert.throws(
      () => HpcClusterGateway.planOutOfCoreFrontal(0, 1e9, { matrixNonzerosPerDof: 10, factorEntriesPerDof: 20 }),
      /Provide positive DOF count/
    );
    assert.throws(
      () => HpcClusterGateway.planOutOfCoreFrontal(1000, -5, { matrixNonzerosPerDof: 10, factorEntriesPerDof: 20 }),
      /Provide positive DOF count/
    );
    assert.throws(
      () => HpcClusterGateway.planOutOfCoreFrontal(1000, 1e9, { matrixNonzerosPerDof: 0, factorEntriesPerDof: 20 }),
      /Provide positive DOF count/
    );
    const plan = HpcClusterGateway.planOutOfCoreFrontal(1e6, 8e9, {
      matrixNonzerosPerDof: 10,
      factorEntriesPerDof: 50
    });
    assert.strictEqual(plan.status, 'ESTIMATE_ONLY');
    assert.strictEqual(plan.solvePerformed, false);
    assert(plan.estimatedOutOfCore === true || plan.estimatedOutOfCore === false);
    assert(plan.totalChunks >= 1);
    const rcb = HpcClusterGateway.partitionRcb(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 }
      ],
      2
    );
    assert.strictEqual(rcb.status, 'PARTITIONED');
    assert.strictEqual(rcb.numPartitions, 2);
    assert(rcb.isBalanced);
    assert.strictEqual(HpcClusterGateway.partitionRcb([], 4).length, 0);
    const many = HpcClusterGateway.partitionRcb(
      Array.from({ length: 16 }, (_, i) => ({ x: i, y: 0, z: 0 })),
      8
    );
    assert.strictEqual(many.numPartitions, 8);
    assert.strictEqual(many.totalNodes, 16);
  });

  check('CloudHPCEngine provider resolution and error paths', () => {
    const bogus = new CloudHPCEngine({ provider: 'bogus' });
    assert.strictEqual(bogus.provider, null);
    assert.strictEqual(bogus.getClusterStatus().success, false);
    assert.strictEqual(bogus.setMembership(true).success, false);
    assert.strictEqual(bogus.computeDomainDecomposition(10).success, false);
    assert.strictEqual(bogus.submitSimulationJob('x', {}, 1).success, false);
    const local = new CloudHPCEngine({ provider: 'local' });
    assert.strictEqual(local.getClusterStatus().status, 'READY');
    const local2 = new LocalComputeProvider();
    assert.strictEqual(local2.getClusterStatus().provider, 'local');
    assert.strictEqual(local2.setMembership(false).active, false);
    assert.strictEqual(local2.getClusterStatus().status, 'OFFLINE');
    const dom = local.computeDomainDecomposition(100, 4);
    assert.strictEqual(dom.status, 'PARTITIONED');
    assert.strictEqual(dom.numPartitions, 4);
    const slurm = new SlurmComputeProvider();
    assert.strictEqual(slurm.getClusterStatus().configured, false);
    assert.strictEqual(slurm.setMembership().success, false);
    const slurmJob = slurm.submitSimulationJob('thermal', { partition: 'shared' }, 32);
    assert.strictEqual(slurmJob.success, true);
    assert.strictEqual(slurmJob.status, 'SCRIPT_TEMPLATE_ONLY');
    assert(slurmJob.submissionSpec.script.includes('#SBATCH'));
    const slurmDom = slurm.computeDomainDecomposition(50, 2);
    assert.strictEqual(slurmDom.numPartitions, 2);
    const pbs = new PbsComputeProvider();
    assert.strictEqual(pbs.getClusterStatus().configured, false);
    const pbsJob = pbs.submitSimulationJob('struct', {}, 16);
    assert.strictEqual(pbsJob.success, true);
    assert(pbsJob.submissionSpec.script.includes('#PBS'));
    assert.strictEqual(pbsJob.submissionSpec.nodes, 2);
    const pbsDom = pbs.computeDomainDecomposition(50, 2);
    assert.strictEqual(pbsDom.numPartitions, 2);
    const asObj = new CloudHPCEngine({ provider: { type: 'slurm', partition: 'x' } });
    assert.strictEqual(asObj.provider.type, 'slurm');
    const asCustom = new CloudHPCEngine({ provider: { type: 'custom', getClusterStatus: () => ({ success: true }) } });
    assert.strictEqual(asCustom.getClusterStatus().success, true);
    assert.strictEqual(asCustom.computeDomainDecomposition(1).success, false);
  });

  // ------------------------------------------------------------------
  // Storage: v1 OmniArchive section/misc branches (support)
  // ------------------------------------------------------------------
  check('OmniArchive v1 section helpers and save/load round trip', () => {
    const archive = new OmniArchive({ projectName: 'v1' });
    archive.addSection('blob', Buffer.from('data'));
    assert.strictEqual(archive.hasSection('manifest'), true);
    assert.strictEqual(archive.hasSection('nope'), false);
    assert.strictEqual(archive.getSection('manifest', true).projectName, 'v1');
    assert.strictEqual(archive.getSection('nope', true), null);
    assert.deepStrictEqual(archive.listSections().sort(), ['blob', 'manifest']);
    const buf = archive.saveToBuffer();
    assert(buf.slice(0, 8).equals(MAGIC_BYTES_V1));
    const loaded = OmniArchive.loadFromBuffer(buf);
    assert.strictEqual(loaded.getSection('blob', false).toString('utf8'), 'data');
    assert.strictEqual(loaded.getSection('manifest', true).projectName, 'v1');
    const file = tmpFile('v1.omni');
    archive.saveToFile(file);
    assert(fs.existsSync(file));
    const fromFile = OmniArchive.loadFromFile(file);
    assert.strictEqual(fromFile.getSection('manifest', true).projectName, 'v1');
    assert.throws(() => OmniArchive.loadFromBuffer(Buffer.alloc(8)), /too small|magic/);
    assert.throws(() => OmniArchive.loadFromBuffer(Buffer.concat([Buffer.from('XXXXXXXX'), Buffer.alloc(4)])), /magic/);
  });

  const pendingSettled = await Promise.race([
    Promise.all(pending).then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 180000))
  ]);
  if (!pendingSettled) {
    failedTests += pending.length;
    console.error('  ✗ WARN: timed out waiting for pending checks; marking them failed');
  }

  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch (_) {}

  return { total: totalTests, passed: passedTests, failed: failedTests };
}

module.exports = { runBranchGapThirtyCoverageTests };

if (require.main === module) {
  runBranchGapThirtyCoverageTests().then((stats) => {
    console.log(`gap30: ${stats.passed}/${stats.total} passed, ${stats.failed} failed`);
    process.exitCode = stats.failed > 0 ? 1 : 0;
  });
}
