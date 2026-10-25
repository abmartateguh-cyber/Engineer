/**
 * OmniEng Experimental Regression Smoke Suite
 * Exercises selected mathematical, physics, CAD, CAE, EDA, GNC, plant, and AI paths.
 */

const assert = require('assert');
const { DOMAIN_MATURITY, getFeatureMaturity, listFeatureMaturity } = require('../src/core/maturity/feature_maturity');
const { runVvStatusContractTests } = require('./test_vv_status_contract');
const { getValidationReadiness } = require('../src/core/vv/validation_readiness');
const { runHertzAnalyticalReference } = require('../src/core/vv/hertz_analytical');
const { ContactMechanics3D } = require('../src/core/cae/contact_mechanics_3d');
const { CONTACT_MECHANICS_SCHEMA } = require('../src/main/ipc/cae_schemas');
const { validateSchema, isTrustedIpcSender, createIpcHandler } = require('../src/main/ipc/define_handler');
const { solveSpiceTransient } = require('../src/core/eda/spice_request');
const {
  handleGdsiiExportRequest,
  handleGdsiiImportRequest,
  handleClockTreeRequest,
  handleBsim4VtcRequest,
  handlePlaceAndRouteRequest,
  handleGerberExportRequest,
  handleDrcRequest,
  handleVerilogSynthesisRequest,
  handleSystemVerilogInspectionRequest,
  handleLefParseRequest,
  handleDefParseRequest,
  handleDefSerializeRequest
} = require('../src/main/ipc/eda_ipc');

// 1. Math Modules
const { Vector3, Quaternion, LinearSolver } = require('../src/core/math/linear_algebra');
const { ODESolvers } = require('../src/core/math/ode_solvers');

// 2. CAD Modules
const { Vertex, Edge, Face, SolidBody, BRepPrimitives } = require('../src/core/cad/brep_topology');
const { ParametricFeature, FeatureTree } = require('../src/core/cad/feature_tree');
const { ConstraintSolver2D } = require('../src/core/cad/constraint_solver_2d');

// 3. CAE Modules
const { FEANode, FEAElement, FEASolver } = require('../src/core/cae/fea_structural');
const { DropTestSimulator } = require('../src/core/cae/drop_test');
const { ThermalEngine } = require('../src/core/cae/thermal_cht');
const { CFDSolver2D } = require('../src/core/cae/cfd_navier_stokes');

// 4. EDA Modules
const { LogicSynthesisEngine, STANDARD_CELL_LIB } = require('../src/core/eda/logic_synthesis');
const { DRCEngine } = require('../src/core/eda/drc_engine');

// 5. Dynamic Simulink & GNC Modules
const { BlockNode, BlockDiagramGraph } = require('../src/core/dynamic_simulink/block_graph');
const { QuadcopterDynamics } = require('../src/core/dynamic_simulink/drone_flight_dynamics');

// 6. Oil & Gas Process Modules
const { PURE_COMPONENTS, ThermodynamicsEngine } = require('../src/core/plant/thermodynamics');
const { PIPING_MATERIALS, ASME_PIPE_SCHEDULES, PipingStressEngine } = require('../src/core/plant/piping_stress');

// 7. OmniAI & Community Samples
const { OmniAIEngine, OMNI_TOOLS } = require('../src/core/ai/omni_ai_engine');
const { CloudHPCEngine } = require('../src/core/hpc/cloud_cluster');
const { AuditReportGenerator } = require('../src/core/reporting/audit_report');
const { MATERIAL_DATABASE, MaterialManager } = require('../src/core/materials/material_database');
const { TransientDropAnimator } = require('../src/core/cae/transient_drop_animator');
const { FrequencyResponseAnalyzer } = require('../src/core/dynamic_simulink/frequency_analysis');
const { VLEPhaseEnvelopeEngine } = require('../src/core/plant/vle_envelope');
const { OpticalEngine } = require('../src/core/optics/optical_engine');
const opticalExamples = require('./support/experimental_optics_examples');
const { getExperimentalThermoProperties } = require('./support/experimental_property_examples');
const { COMMUNITY_SAMPLES } = require('../src/samples/community_samples');

async function runAllTests() {
  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;
  let unavailableValidationCases = 0;
  const pendingTests = [];
  const unhandledRejections = [];
  const onUnhandledRejection = (reason) => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);

  function test(name, fn) {
    totalTests++;
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pendingTests.push(
          Promise.resolve(result).then(
            () => {
              passedTests++;
              console.log(`  ✓ ${name}`);
            },
            (err) => {
              failedTests++;
              console.error(`  ✗ FAIL: ${name}`);
              console.error(`    ${err.message}`);
            }
          )
        );
        return;
      }
      passedTests++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  test('V&V outcome summary separates unavailable references from failed checks', () => {
    const summary = runVvStatusContractTests();
    assert.deepStrictEqual(summary, { total: 1, passed: 1, failed: 0 });
  });

  test('Production modules cannot import from the test tree', async () => {
    const { runProductionImportBoundaryTests } = require('./test_production_import_boundary');
    assert.deepStrictEqual(await runProductionImportBoundaryTests(), { total: 1, passed: 1, failed: 0 });
  });

  test('Bode UI consumes production response samples without unsupported margins or HTML sinks', () => {
    const { runBodeUiContractTests } = require('./test_bode_ui_contract');
    assert.deepStrictEqual(runBodeUiContractTests(), { total: 1, passed: 1, failed: 0 });
  });

  test('EDA result metrics render returned values as DOM text', () => {
    const { runEdaResultViewTests } = require('./test_eda_result_view');
    assert.deepStrictEqual(runEdaResultViewTests(), { total: 1, passed: 1, failed: 0 });
  });

  test('Optics and piping metrics render returned values as DOM text', () => {
    const { runEngineeringResultViewTests } = require('./test_engineering_result_view');
    assert.deepStrictEqual(runEngineeringResultViewTests(), { total: 1, passed: 1, failed: 0 });
  });

  test('Workspace tab labels use DOM text rather than HTML interpolation', () => {
    const { runWorkspaceTabViewTests } = require('./test_workspace_tab_view');
    assert.deepStrictEqual(runWorkspaceTabViewTests(), { total: 1, passed: 1, failed: 0 });
  });

  test('3D measurement HUD renders finite values as DOM text', () => {
    const { runMeasurementHudViewTests } = require('./test_measurement_hud_view');
    assert.deepStrictEqual(runMeasurementHudViewTests(), { total: 1, passed: 1, failed: 0 });
  });

  test('Command-palette results render catalog values as DOM text', () => {
    const { runCommandPaletteViewTests } = require('./test_command_palette_view');
    assert.deepStrictEqual(runCommandPaletteViewTests(), { total: 1, passed: 1, failed: 0 });
  });

  test('Object property grid renders entity metadata as DOM text', () => {
    const { runPropertyGridViewTests } = require('./test_property_grid_view');
    assert.deepStrictEqual(runPropertyGridViewTests(), { total: 1, passed: 1, failed: 0 });
  });

  test('First-party renderer HTML sinks stay within the reviewed inventory', () => {
    const { checkRendererSinkInventory } = require('../scripts/check_renderer_sinks');
    assert.deepStrictEqual(checkRendererSinkInventory(), {
      rendererDocuments: ['index.html', 'ui/panel_host.html'],
      firstPartyScriptCount: 31,
      thirdPartyScripts: ['vendor/three.min.js'],
      innerHTMLAssignments: {
        'ui/app.js': 12,
        'ui/icons.js': 1,
        'ui/optical_inspector_ui.js': 2,
        'ui/spice_oscilloscope_ui.js': 1
      },
      innerHTMLAssignmentCount: 16
    });
  });

  test('Renderer documents block inline scripts and use external same-origin scripts', () => {
    const fs = require('fs');
    const path = require('path');
    for (const relativePath of ['src/index.html', 'src/ui/panel_host.html']) {
      const html = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
      const cspTag = html.match(/<meta\b(?=[^>]*http-equiv=["']Content-Security-Policy["'])[^>]*>/i)?.[0];
      assert(cspTag, `${relativePath} must declare a Content-Security-Policy`);
      const csp = cspTag.match(/\bcontent="([^"]*)"/i)?.[1];
      assert(csp, `${relativePath} must provide a CSP value`);
      const scriptPolicy = csp
        .split(';')
        .map((directive) => directive.trim())
        .find((directive) => directive.startsWith('script-src '));
      assert(scriptPolicy, `${relativePath} must declare script-src`);
      assert(!scriptPolicy.includes("'unsafe-inline'"), `${relativePath} must block inline scripts`);

      const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
      for (const [, attributes, body] of scriptTags) {
        assert(/\bsrc\s*=/i.test(attributes), `${relativePath} scripts must load from a same-origin file`);
        assert.strictEqual(body.trim(), '', `${relativePath} must not contain inline script bodies`);
      }
      assert(!/<[a-z][^>]*\son[a-z][a-z0-9_-]*\s*=/i.test(html), `${relativePath} must not use inline event handlers`);
    }
  });

  test('SPICE transient route requires explicit circuit inputs and returns solver samples', () => {
    const result = solveSpiceTransient({
      analysis: { type: 'transient', stopTimeS: 0.004, stepS: 0.0001 },
      components: [
        {
          type: 'voltage_source',
          id: 'V1',
          nPlus: 'in',
          nMinus: '0',
          dcVoltageV: 5,
          waveform: { type: 'STEP', lowV: 0, highV: 5, delayS: 0 }
        },
        { type: 'resistor', id: 'R1', n1: 'in', n2: 'out', resistanceOhm: 1000 },
        { type: 'capacitor', id: 'C1', n1: 'out', n2: '0', capacitanceF: 1e-6, initialVoltageV: 0 }
      ]
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.validationLevel, 'experimental');
    assert.strictEqual(result.dataStatus, 'caller-supplied inputs');
    assert(result.transient.time.length > 1);
    assert.strictEqual(result.transient.time[0], 0);
    assert.strictEqual(result.transient.time.at(-1), 4);
    assert.strictEqual(result.transient.waveforms.out.length, result.transient.time.length);
    assert(result.warnings.some((warning) => warning.includes('not been independently validated')));
  });

  test('SPICE transient route does not supply a hidden circuit or analysis default', () => {
    const result = solveSpiceTransient({});
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'INVALID_INPUT');
  });

  test('SPICE transient route rejects unbounded time steps and unknown component properties', () => {
    const base = {
      analysis: { type: 'transient', stopTimeS: 1, stepS: 1e-9 },
      components: [{ type: 'current_source', id: 'I1', nFrom: 'n1', nTo: '0', currentA: 0 }]
    };
    assert.match(solveSpiceTransient(base).error.message, /limited to 2000 time steps/);

    const unexpectedProperty = {
      analysis: { type: 'transient', stopTimeS: 0.001, stepS: 0.0001 },
      components: [{ type: 'current_source', id: 'I1', nFrom: 'n1', nTo: '0', currentA: 0, defaulted: true }]
    };
    assert.match(solveSpiceTransient(unexpectedProperty).error.message, /missing or unsupported fields/);
  });

  test('SPICE transient route reports singular circuits as numerical failures', () => {
    const result = solveSpiceTransient({
      analysis: { type: 'transient', stopTimeS: 0.001, stepS: 0.0001 },
      components: [{ type: 'current_source', id: 'I1', nFrom: 'n1', nTo: '0', currentA: 0 }]
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error.code, 'NUMERICAL_FAILURE');
  });

  test('SPICE waveform UI starts without example data and plots only returned node samples', () => {
    const { SpiceOscilloscopeUI } = require('../src/ui/spice_oscilloscope_ui');
    const drawingContext = {
      clearRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      setLineDash() {}
    };
    const makeElement = () => ({
      children: [],
      style: {},
      hidden: false,
      textContent: '',
      listeners: {},
      addEventListener(name, listener) {
        this.listeners[name] = listener;
      },
      replaceChildren() {
        this.children = [];
      },
      append(child) {
        this.children.push(child);
      },
      getContext() {
        return drawingContext;
      },
      getBoundingClientRect() {
        return { left: 0, width: 780 };
      }
    });
    const selectors = [
      '#canvas-oscilloscope-screen',
      '#spice-request-form',
      '#spice-run-status',
      '#spice-run-button',
      '#spice-request-json',
      '#spice-result-panel',
      '#spice-node-legend',
      '#spice-run-summary',
      '#spice-run-warnings',
      '#scope-cursor-readout'
    ];
    const elements = new Map(selectors.map((selector) => [selector, makeElement()]));
    const container = {
      innerHTML: '',
      querySelector(selector) {
        return elements.get(selector) || null;
      }
    };
    const previousDocument = global.document;
    global.document = {
      getElementById: () => container,
      createElement: () => makeElement()
    };

    try {
      const ui = new SpiceOscilloscopeUI('spice-oscilloscope-body', async () => {
        throw new Error('The UI must not auto-run a simulation.');
      });
      ui.render();
      assert.match(container.innerHTML, /Circuit and analysis JSON/);
      assert.match(container.innerHTML, /id="spice-result-panel" hidden/);
      assert.doesNotMatch(
        container.innerHTML,
        /RC Low-Pass Filter Step Response|Final Steady-State: 5\.00 V|Theoretical 2\.2·RC/
      );

      ui.renderResult({
        success: true,
        analysis: { stepS: 0.001 },
        transient: { time: [0, 1, 2], nodes: { 0: [0, 0, 0], out: [0, 1.25, 2.5] } },
        warnings: ['Experimental result from supplied inputs.']
      });
      assert.strictEqual(ui.waveforms.length, 1);
      assert.strictEqual(ui.waveforms[0].name, 'out');
      assert.deepStrictEqual(
        ui.waveforms[0].points.map((point) => point.v),
        [0, 1.25, 2.5]
      );
      assert.strictEqual(elements.get('#spice-result-panel').hidden, false);
      assert.match(elements.get('#spice-run-summary').textContent, /3 returned samples/);
      assert.match(elements.get('#spice-run-warnings').textContent, /Experimental result/);
    } finally {
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
    }
  });

  test('GDSII export requires caller geometry and serializes only explicit layout records', () => {
    const missing = handleGdsiiExportRequest({});
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.error.code, 'INVALID_INPUT');

    const request = {
      libName: 'CallerLayout',
      userUnits: 1e-3,
      dbUnits: 1e-9,
      topCell: 'CallerTop',
      polygons: [
        {
          layer: 4,
          datatype: 2,
          points: [
            { x: -10, y: -10 },
            { x: 10, y: -10 },
            { x: 10, y: 10 },
            { x: -10, y: 10 }
          ]
        }
      ]
    };
    const result = handleGdsiiExportRequest(request);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.validationLevel, 'experimental');
    assert.strictEqual(result.dataStatus, 'caller-supplied layout geometry');
    assert(Number.isInteger(result.sizeBytes) && result.sizeBytes > 0);
    assert.strictEqual(Buffer.from(result.base64, 'base64').length, result.sizeBytes);
    assert.match(result.warnings.join(' '), /does not validate design rules/);

    const imported = handleGdsiiImportRequest(result.base64);
    assert.strictEqual(imported.success, true);
    assert.strictEqual(imported.libraryName, 'CallerLayout');
    assert.deepStrictEqual(imported.structures, ['CallerTop']);
    assert.strictEqual(handleGdsiiImportRequest(undefined).error.code, 'INVALID_INPUT');

    const withUnexpectedProperty = handleGdsiiExportRequest({ ...request, fabricated: true });
    assert.strictEqual(withUnexpectedProperty.success, false);
    assert.strictEqual(withUnexpectedProperty.error.code, 'INVALID_INPUT');
  });

  test('Gerber IPC exports only explicit board inputs and returns all generated layer files', () => {
    const missing = handleGerberExportRequest({});
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.error.code, 'INVALID_INPUT');

    const request = {
      traces: [{ x1: 1, y1: 1, x2: 8, y2: 1, widthMm: 0.25 }],
      pads: [{ x: 1, y: 1, shape: 'CIRCLE', diameterMm: 1.2 }],
      vias: [],
      solderMaskOpenings: [{ x: 1, y: 1, shape: 'CIRCLE', diameterMm: 1.4 }],
      holes: [{ x: 1, y: 1, drillMm: 0.6 }],
      boardOutline: { xMin: 0, yMin: 0, xMax: 10, yMax: 5, outlineWidthMm: 0.1 }
    };
    const result = handleGerberExportRequest(request);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.validationLevel, 'experimental');
    assert.match(result.package.files['TopCopper.gtl'], /X00100000Y00100000D02\*/);
    assert.match(result.package.files['Drill.drl'], /T01C0\.600/);
    assert.match(result.package.files['BoardOutline.gko'], /Board_Outline_GKO/);
    assert.strictEqual(Object.keys(result.package.files).length, 4);

    const unexpected = handleGerberExportRequest({ ...request, example: true });
    assert.strictEqual(unexpected.success, false);
    assert.strictEqual(unexpected.error.code, 'INVALID_INPUT');
  });

  test('Clock-tree and grid-route IPC requires explicit sinks, model settings, and endpoints', () => {
    const missing = handleClockTreeRequest({});
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.error.code, 'INVALID_INPUT');

    const result = handleClockTreeRequest({
      sinks: [
        { id: 'sink_a', x: 1, y: 1, capPf: 0.01 },
        { id: 'sink_b', x: 3, y: 3, capPf: 0.02 }
      ],
      rootPosition: { x: 2, y: 2 },
      options: { targetSkewPs: 20, bufferDelayNs: 0.045, wireResistancePerUm: 0.15, wireCapacitancePerUmPf: 0.0002 },
      routingGrid: { width: 4, height: 4, layers: 1 },
      routeStart: { x: 0, y: 0, layer: 0 },
      routeEnd: { x: 3, y: 3, layer: 0 }
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.validationLevel, 'experimental');
    assert.strictEqual(result.tree.sinkCount, 2);
    assert.strictEqual(result.route.success, true);
    assert(result.warnings.length > 0);
  });

  test('BSIM compact-model IPC requires both explicit models and caller bias', () => {
    const missing = handleBsim4VtcRequest({});
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.error.code, 'INVALID_INPUT');

    const sharedModel = { W: 1e-6, L: 1.3e-7, tox: 2.5e-9, mu0: 0.04, vsat: 1e5, dibl_eta: 0.06, lambda: 0.04 };
    const result = handleBsim4VtcRequest({
      nmos: { ...sharedModel, type: 'nmos', Vth0: 0.42 },
      pmos: { ...sharedModel, type: 'pmos', W: 2.5e-6, Vth0: -0.42 },
      bias: { vgsV: 0.8, vdsV: 0.8, vbsV: 0 },
      vddV: 1.2,
      sweepPoints: 10
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.validationLevel, 'experimental');
    assert(Number.isFinite(result.idSat));
    assert.strictEqual(result.vtc.Vdd, 1.2);
    assert.strictEqual(result.vtc.curvePoints, 11);
    assert(result.warnings.some((warning) => warning.includes('not a foundry-qualified')));
  });

  test('Place-and-route IPC requires caller cells, two-pin nets, and core dimensions', () => {
    const missing = handlePlaceAndRouteRequest({});
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.error.code, 'INVALID_INPUT');

    const result = handlePlaceAndRouteRequest({
      options: { coreWidth: 100, coreHeight: 100, stdCellHeight: 10 },
      cells: [
        { id: 'cell_a', width: 4, height: 10 },
        { id: 'cell_b', width: 6, height: 10 }
      ],
      nets: [{ name: 'net_ab', pins: ['cell_a', 'cell_b'] }]
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.dataStatus, 'caller-supplied cells and nets');
    assert.strictEqual(result.cellsPlacedCount, 2);
    assert.strictEqual(result.netsRoutedCount, 1);
    assert(result.warnings.some((warning) => warning.includes('overlap, DRC, timing')));
  });

  test('Preload API preserves every v1 compatibility method without duplicate names', () => {
    const { checkPreloadCompatibility } = require('./test_preload_compatibility');
    const result = checkPreloadCompatibility();
    assert.strictEqual(result.baselineCount, 137);
    assert.deepStrictEqual(result.missing, []);
    assert.deepStrictEqual(result.duplicates, []);
    assert(result.currentCount >= result.baselineCount);
  });

  test('Encrypted session snapshot IPC authenticates selected bytes and enforces payload bounds', () => {
    const { spawnSync } = require('child_process');
    const path = require('path');
    const child = spawnSync(process.execPath, [path.join(__dirname, 'test_session_snapshot_ipc.js')], {
      encoding: 'utf8',
      timeout: 30000
    });
    if (child.error) throw child.error;
    assert.strictEqual(child.status, 0, `${child.stdout}\n${child.stderr}`);
    assert.match(child.stdout, /Session snapshot IPC integration passed/);
  });

  test('Root test watchdog escalates to SIGKILL when a timed-out child ignores SIGTERM', async () => {
    const { spawn } = require('child_process');
    const { watchChildProcess } = require('../scripts/run_tests_clean');
    const child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('READY');"],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let watchdog;

    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.stdout.once('data', resolve);
      });
      watchdog = watchChildProcess(child, { timeoutMs: 50, terminationGraceMs: 50 });
      const close = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
      });

      assert.strictEqual(watchdog.timedOut, true);
      assert.strictEqual(close.signal, 'SIGKILL');
    } finally {
      watchdog?.clear();
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  console.log('====================================================');
  console.log('   OmniEng Experimental Smoke Suite — no released validation evidence       ');
  console.log('====================================================\n');

  test('Feature maturity registry marks all listed domains experimental by default', () => {
    assert(Object.keys(DOMAIN_MATURITY).length > 0, 'Maturity registry must list engineering domains');
    for (const [domain, maturity] of Object.entries(DOMAIN_MATURITY)) {
      assert.strictEqual(maturity.state, 'experimental', `${domain} must remain experimental without release evidence`);
      assert.strictEqual(maturity.releaseApproved, false, `${domain} must not be release-approved`);
      assert.strictEqual(getFeatureMaturity(domain).state, 'experimental');
    }
    assert.strictEqual(getFeatureMaturity('unregistered-domain').state, 'experimental');
    const listed = listFeatureMaturity();
    assert.deepStrictEqual(Object.keys(listed).sort(), Object.keys(DOMAIN_MATURITY).sort());
    listed.cad.state = 'released';
    assert.strictEqual(
      DOMAIN_MATURITY.cad.state,
      'experimental',
      'Listed maturity records must not mutate the registry'
    );
  });

  test('IPC sender authorization accepts only the trusted main-frame application document', () => {
    const path = require('path');
    const { pathToFileURL } = require('url');
    const trustedEntryPath = path.resolve(__dirname, '../src/index.html');
    const mainFrame = { url: pathToFileURL(trustedEntryPath).href, frameTreeNodeId: 1 };
    const sender = { mainFrame: { frameTreeNodeId: 1 }, isDestroyed: () => false };

    assert.strictEqual(isTrustedIpcSender({ sender, senderFrame: mainFrame }, trustedEntryPath), true);
    assert.strictEqual(
      isTrustedIpcSender(
        { sender, senderFrame: { url: 'file:///tmp/untrusted.html', frameTreeNodeId: 1 } },
        trustedEntryPath
      ),
      false
    );
    assert.strictEqual(
      isTrustedIpcSender(
        { sender, senderFrame: { url: 'https://example.invalid/', frameTreeNodeId: 1 } },
        trustedEntryPath
      ),
      false
    );
    assert.strictEqual(
      isTrustedIpcSender({ sender, senderFrame: { url: mainFrame.url, frameTreeNodeId: 2 } }, trustedEntryPath),
      false
    );
    assert.strictEqual(
      isTrustedIpcSender({ sender, senderFrame: mainFrame }, path.resolve(__dirname, '../other.html')),
      false
    );
    assert.strictEqual(
      isTrustedIpcSender({ sender: { ...sender, isDestroyed: () => true }, senderFrame: mainFrame }, trustedEntryPath),
      false
    );
    assert.strictEqual(isTrustedIpcSender({ sender, senderFrame: null }, trustedEntryPath), false);
  });

  test('IPC handler rejects an untrusted sender before route execution', async () => {
    const path = require('path');
    const { pathToFileURL } = require('url');
    const trustedEntryPath = path.resolve(__dirname, '../src/index.html');
    const mainFrame = { url: pathToFileURL(trustedEntryPath).href, frameTreeNodeId: 1 };
    const trustedEvent = {
      sender: { mainFrame: { frameTreeNodeId: 1 }, isDestroyed: () => false },
      senderFrame: mainFrame
    };
    const untrustedEvent = {
      sender: trustedEvent.sender,
      senderFrame: { url: 'https://example.invalid/', frameTreeNodeId: 2 }
    };
    let handlerCalls = 0;
    const guardedHandler = createIpcHandler(
      'omni:sender-guard-test',
      {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'number' } },
        additionalProperties: false
      },
      async (_event, params) => {
        handlerCalls++;
        return { value: params.value };
      },
      () => trustedEntryPath
    );

    await assert.rejects(guardedHandler(untrustedEvent, { unexpected: true }), /untrusted sender frame/);
    assert.strictEqual(handlerCalls, 0);
    assert.deepStrictEqual(await guardedHandler(trustedEvent, { value: 7 }), { value: 7 });
    assert.strictEqual(handlerCalls, 1);
  });

  test('Production V&V readiness reports missing independent evidence as unavailable', () => {
    const readiness = getValidationReadiness();
    assert.strictEqual(readiness.status, 'unavailable');
    assert.strictEqual(readiness.available, 0);
    assert(readiness.total > 0, 'Validation registry must list the reference cases under audit');
    assert.strictEqual(readiness.unavailable, readiness.total);
    for (const result of readiness.results) {
      assert.strictEqual(result.status, 'unavailable', `${result.id} must not be presented as a pass`);
      assert(result.reason.length > 0, `${result.id} must explain why it is unavailable`);
    }
    const nasaTmr = readiness.results.find((result) => result.id === 'NASA_TMR_FLAT_PLATE');
    assert.strictEqual(nasaTmr.referenceDataStatus, 'bundled-theoretical-correlation');
    assert.strictEqual(nasaTmr.solverAdapterStatus, 'unavailable');
    const nafemsT1 = readiness.results.find((result) => result.id === 'NAFEMS_T1');
    assert.strictEqual(nafemsT1.name, 'Membrane with hot-spot thermo-elastic reference case');
    const hanoverBeam = readiness.results.find((result) => result.id === 'HANOVER_BEAM_DYNAMIC_RESPONSE');
    assert.strictEqual(hanoverBeam.status, 'unavailable');
    assert.strictEqual(hanoverBeam.referenceDataStatus, 'external-experimental-measurements');
    assert.strictEqual(hanoverBeam.referenceDataDoi, '10.25835/lyav246d');
    assert.strictEqual(
      hanoverBeam.referenceDataAttribution,
      'Jonathan Thurn, Clemens Jonscher, and Raimund Rolfes (2025)'
    );
    assert.strictEqual(hanoverBeam.referenceDataLicense, 'CC-BY-3.0');
    assert.strictEqual(hanoverBeam.referenceDataLicenseUrl, 'https://creativecommons.org/licenses/by/3.0/');
    assert.strictEqual(hanoverBeam.solverAdapterStatus, 'unavailable');
    assert.match(hanoverBeam.referenceDataSource, /data\.uni-hannover\.de/);
    assert.deepStrictEqual(hanoverBeam.referenceDataArtifacts, [
      {
        fileName: 'ReadMe.pdf',
        byteLength: 49575522,
        sha256: '181e6bbec901ccd0cdc7c9c674fa131d3b7a35671603d7f8a475b268ba542615'
      },
      {
        fileName: 'Data_strain_estimation_laboratory_beam.mat',
        byteLength: 15090174,
        sha256: '793ec8ae54cd36972880f1893bf5987684439f63119011583844e46f5e0da93f'
      },
      {
        fileName: 'Beam_model.inp',
        byteLength: 124337,
        sha256: 'b3d413af19f32512936931f1573b9cae3210ef1675f3d4f08723334ca047141d'
      }
    ]);
    assert.match(hanoverBeam.reason, /No solver comparison was run/);
  });

  test('Hertz contact formula check passes while the legacy route rejects defaults and reports no solver', () => {
    const verification = runHertzAnalyticalReference();
    assert.strictEqual(verification.passed, true, verification.reason);
    assert.strictEqual(verification.metadata.solverExecuted, false);

    assert.throws(() => validateSchema({}, CONTACT_MECHANICS_SCHEMA), /Missing required object property/);
    assert.throws(
      () =>
        validateSchema(
          {
            radius: 0,
            load: 1000,
            E1: 210e9,
            nu1: 0.3,
            E2: 210e9,
            nu2: 0.3
          },
          CONTACT_MECHANICS_SCHEMA
        ),
      /Number at '.*radius.*'|Number at .*radius/
    );

    const estimate = new ContactMechanics3D().solveSphereOnFlatContact({
      radius1: 0.02,
      load: 1000,
      E1: 210e9,
      nu1: 0.3,
      E2: 210e9,
      nu2: 0.3
    });
    assert.strictEqual(estimate.solverExecuted, false);
    assert.strictEqual(estimate.converged, false);
    assert.strictEqual(estimate.isHertzCompliant, null);
    assert.strictEqual(estimate.status, 'estimate-only');
  });

  // ----------------------------------------------------
  // Suite 1: Core Math & Linear Algebra
  // ----------------------------------------------------
  console.log('1. Testing Linear Algebra & Vector Math:');

  test('Vector3 arithmetic (add, sub, scale, dot, cross, distanceTo)', () => {
    const v1 = new Vector3(1, 2, 3);
    const v2 = new Vector3(4, 5, 6);
    const fromArray = Vector3.fromArray([7, 8, 9]);
    assert.deepStrictEqual(fromArray.toArray(), [7, 8, 9]);
    assert.strictEqual(fromArray.set(1, 2, 3), fromArray);
    assert.deepStrictEqual(fromArray.toArray(), [1, 2, 3]);

    const vAdd = v1.clone().add(v2);
    assert.strictEqual(vAdd.x, 5);
    assert.strictEqual(vAdd.y, 7);
    assert.strictEqual(vAdd.z, 9);

    const dot = v1.dot(v2); // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    assert.strictEqual(dot, 32);

    const cross = new Vector3(1, 0, 0).cross(new Vector3(0, 1, 0));
    assert.strictEqual(cross.x, 0);
    assert.strictEqual(cross.y, 0);
    assert.strictEqual(cross.z, 1);

    const dist = new Vector3(0, 0, 0).distanceTo(new Vector3(3, 4, 0));
    assert.strictEqual(dist, 5);
  });

  test('Quaternion orientation and Euler rotation conversion', () => {
    const q = new Quaternion();
    assert.strictEqual(q.set(1, 0, 0, 0), q);
    q.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2); // 90 deg around Z

    const v = new Vector3(1, 0, 0);
    const vRot = q.rotateVector(v);
    assert(Math.abs(vRot.x - 0) < 1e-5);
    assert(Math.abs(vRot.y - 1) < 1e-5);
    assert(Math.abs(vRot.z - 0) < 1e-5);

    const euler = q.toEulerAngles();
    assert(Math.abs(euler.yaw - Math.PI / 2) < 1e-5);
    const fromEuler = Quaternion.fromEuler(0, 0, Math.PI / 2);
    const rotated = fromEuler.rotateVector(new Vector3(1, 0, 0));
    assert(Math.abs(rotated.x) < 1e-12);
    assert(Math.abs(rotated.y - 1) < 1e-12);
  });

  test('LinearSolver: Gaussian Elimination & Conjugate Gradient', () => {
    // 2x2 system:
    // 2*x + 1*y = 5
    // 1*x + 3*y = 5  => solution: x=2, y=1
    const A = [
      [2, 1],
      [1, 3]
    ];
    const b = [5, 5];

    const xGauss = LinearSolver.solveGaussian(A, b);
    assert(Math.abs(xGauss[0] - 2.0) < 1e-5, `Expected 2.0, got ${xGauss[0]}`);
    assert(Math.abs(xGauss[1] - 1.0) < 1e-5, `Expected 1.0, got ${xGauss[1]}`);

    const xCG = LinearSolver.solveConjugateGradient(A, b, [0, 0], 50, 1e-8);
    assert(Math.abs(xCG[0] - 2.0) < 1e-3, `Expected ~2.0, got ${xCG[0]}`);
    assert(Math.abs(xCG[1] - 1.0) < 1e-3, `Expected ~1.0, got ${xCG[1]}`);
  });

  // ----------------------------------------------------
  // Suite 2: ODE Solvers
  // ----------------------------------------------------
  console.log('\n2. Testing ODE Solvers:');

  test('ODESolvers: Explicit RK4 for exponential decay dy/dt = -y', () => {
    // y(t) = y0 * exp(-t). y(0)=1, at t=1, y(1) = 1/e ~ 0.367879
    const f = (t, y) => [-y[0]];
    const traj = ODESolvers.solveRK4(f, [1.0], 0, 1.0, 0.01);
    const finalState = traj[traj.length - 1];

    assert.strictEqual(finalState.t, 1.0);
    assert(Math.abs(finalState.y[0] - Math.exp(-1.0)) < 1e-4);

    const aliased = ODESolvers.rk4(f, 0, [1.0], 0.1, 10);
    assert(Math.abs(aliased.at(-1).y[0] - Math.exp(-1.0)) < 1e-5);

    const stiff = ODESolvers.bdf1Stiff(
      (_t, y) => [-50 * y[0]],
      () => [[-50]],
      0,
      [1],
      0.1,
      5
    );
    assert.strictEqual(stiff.length, 6);
    assert(Math.abs(stiff.at(-1).y[0] - Math.pow(1 / 6, 5)) < 1e-10);
  });

  test('ODESolvers: Adaptive RK45 (Dormand-Prince / ODE45)', () => {
    const f = (t, y) => [-2.0 * y[0]];
    const traj = ODESolvers.solveRK45(f, [1.0], 0, 2.0, 0.05, 1e-6);
    const finalState = traj[traj.length - 1];

    assert(finalState.t >= 2.0);
    assert(Math.abs(finalState.y[0] - Math.exp(-4.0)) < 1e-4);
  });

  // ----------------------------------------------------
  // Suite 3: Parametric B-Rep CAD Kernel
  // ----------------------------------------------------
  console.log('\n3. Testing B-Rep Topological Kernel:');

  test('ConstraintSolver2D: vertical and coincidence residuals use point coordinates', () => {
    const solver = new ConstraintSolver2D();
    solver.addPoint('left', 0, 0);
    solver.addPoint('right', 0, 2);
    solver.addVertical('left', 'right');
    solver.addCoincident('left', 'right');
    assert.deepStrictEqual(solver.evaluateResiduals([0, 0, 0, 2]), [0, 0, -2]);
  });

  test('BRepPrimitives: Box creation, topology and volume', () => {
    const box = BRepPrimitives.createBox(10, 20, 30, 'TestBox');
    assert.strictEqual(box.vertices.length, 8);
    assert.strictEqual(box.faces.length, 6);

    const vol = box.computeVolume();
    assert(Math.abs(vol - 10 * 20 * 30) < 1e-4, `Expected 6000, got ${vol}`);

    const triangles = box.toTriangles();
    assert.strictEqual(triangles.length, 12); // 6 faces * 2 triangles

    const obj = box.toOBJ();
    assert(obj.includes('o TestBox'));
    assert(obj.includes('v '));
    assert(obj.includes('f '));
  });

  test('BRepPrimitives: Cylinder creation and volume approximation', () => {
    const r = 5;
    const h = 20;
    const cyl = BRepPrimitives.createCylinder(r, h, 32, 'TestCyl');
    const expectedVol = Math.PI * r * r * h; // ~1570.79
    const vol = cyl.computeVolume();

    // 32-sided polygon should be within 1.5% of true cylinder volume
    assert(Math.abs(vol - expectedVol) / expectedVol < 0.015);
  });

  test('FeatureTree: Parametric DAG, parameter edits and serialization', () => {
    const tree = new FeatureTree();
    const f1 = new ParametricFeature('box', 'BasePlate', { width: 100, height: 10, depth: 50 });
    tree.addFeature(f1);
    assert.strictEqual(tree.features.length, 1);
    assert.strictEqual(tree.currentSolid.name, 'BasePlate');
    assert.strictEqual(tree.currentSolid.computeVolume(), 50000);

    // Live parameter update
    tree.updateFeatureParam(f1.id, 'width', 120);
    assert.strictEqual(tree.currentSolid.computeVolume(), 60000);

    // Serialization to and from JSON
    const json = tree.toJSON();
    const restored = FeatureTree.fromJSON(json);
    assert.strictEqual(restored.features.length, 1);
    assert.strictEqual(restored.currentSolid.computeVolume(), 60000);
  });

  // ----------------------------------------------------
  // Suite 4: Structural FEA (Finite Element Analysis)
  // ----------------------------------------------------
  console.log('\n4. Testing structural solver example:');

  test('FEASolver: 3D TET4 assembly, Dirichlet boundary conditions & solve', () => {
    const solver = new FEASolver();

    // Create 4 vertices of a tetrahedral element
    const n0 = solver.addNode(0, 0, 0);
    const n1 = solver.addNode(0.1, 0, 0);
    const n2 = solver.addNode(0, 0.1, 0);
    const n3 = solver.addNode(0, 0, 0.1);

    const mat = { E: 69e9, nu: 0.33, yieldStress: 270e6, name: 'Al6061' };
    solver.addElement([n0.id, n1.id, n2.id, n3.id], mat);

    // Fix base nodes (Dirichlet BCs)
    solver.fixNode(n0.id, true, true, true);
    solver.fixNode(n1.id, true, true, true);
    solver.fixNode(n2.id, true, true, true);

    // Apply tensile force on top node
    solver.applyForce(n3.id, 0, 0, 1000); // 1000 N

    const results = solver.solve();
    assert(results !== null);
    assert(results.dofCount === 12);
    assert(results.elements.length === 1);
    assert(results.elements[0].vonMisesStress > 0);
    assert(typeof results.maxDisplacement === 'number');
  });

  // ----------------------------------------------------
  // Suite 5: Consumer Electronics (Drop Test & Thermal CHT)
  // ----------------------------------------------------
  console.log('\n5. Testing Consumer Electronics Engines:');

  test('DropTestSimulator: experimental handset impact estimate', () => {
    const res = DropTestSimulator.runSimulation({
      dropHeight: 1.5,
      phoneMass: 0.205,
      impactAngle: 'corner'
    });

    assert(res.impactVelocity > 5.0 && res.impactVelocity < 6.0, `Expected ~5.42 m/s, got ${res.impactVelocity}`);
    assert(res.peakForce_N > 100, `Expected peak force > 100N, got ${res.peakForce_N}`);
    assert(res.peakDeceleration_G > 50, `Expected deceleration > 50G, got ${res.peakDeceleration_G}`);
    assert.strictEqual(res.validationLevel, 'experimental');
    assert.strictEqual(res.screeningStatus, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(res.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(Object.hasOwn(res, 'glassCrackDetected'), false);
    assert.strictEqual(Object.hasOwn(res, 'chassisPermanentDeformation'), false);
    assert.strictEqual(res.inputs.phoneMassKg, 0.205);
    assert.strictEqual(res.inputs.dropHeightM, 1.5);
    assert(res.modelAssumptions.contactForceCoefficientNPerMPow1_2 > 0);
    assert(res.modelAssumptions.dampingCoefficientNsPerM > 0);
    assert.strictEqual(res.modelAssumptions.gravityMPerS2, 9.80665);
    assert(res.timeHistory.length > 0);
    assert.throws(() => DropTestSimulator.runSimulation(), /dropHeight.*phoneMass.*impactAngle/i);
    assert.throws(
      () => DropTestSimulator.runSimulation({ dropHeight: 1.5, impactAngle: 'corner' }),
      /dropHeight.*phoneMass.*impactAngle/i
    );
  });

  test('ThermalEngine: handset thermal analysis reports unavailable without reviewed inputs and validation', () => {
    const res = ThermalEngine.simulateSmartphoneThermal({
      socPowerWatts: 8.5,
      hasVaporChamber: true,
      chassisMaterial: 'Titanium'
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.available, false);
    assert.strictEqual(res.status, 'UNAVAILABLE');
    assert.match(res.reason, /reviewed handset thermal model or material-property set/i);
    assert.strictEqual(Object.hasOwn(res, 'maxSocTempC'), false);
    assert.strictEqual(Object.hasOwn(res, 'verdict'), false);

    assert.strictEqual(ThermalEngine.solveTransientConduction2D({}).status, 'INVALID_INPUT');
    const grid = (value) => Array.from({ length: 3 }, () => Array(3).fill(value));
    const conduction = ThermalEngine.solveTransientConduction2D({
      widthM: 0.03,
      heightM: 0.03,
      ambientTemperatureC: 25,
      convectionCoefficientWPerM2K: 10,
      timeStepSec: 0.01,
      totalTimeSec: 0.1,
      initialTemperatureC: grid(25),
      conductivityWPerMK: grid(1),
      volumetricHeatCapacityJPerM3K: grid(1e6),
      heatGenerationWPerM3: grid(1000)
    });
    assert.strictEqual(conduction.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(conduction.validationLevel, 'experimental');
    assert.strictEqual(conduction.results.temperatureC.length, 3);
    assert.deepStrictEqual(
      conduction.results.temperatureMap,
      ThermalEngine.exportSampledHeatmap(conduction.results.temperatureC, 3, 3)
    );
    assert(conduction.results.maximumTemperatureC > 25);
    assert.strictEqual(Object.hasOwn(conduction, 'verdict'), false);
    assert.throws(
      () => ThermalEngine.exportSampledHeatmap([[Number.NaN]], 1, 1, 1, 1),
      /rectangular and contain only finite values/i
    );

    const unstable = ThermalEngine.solveTransientConduction2D({
      widthM: 0.03,
      heightM: 0.03,
      ambientTemperatureC: 25,
      convectionCoefficientWPerM2K: 10,
      timeStepSec: 100,
      totalTimeSec: 100,
      initialTemperatureC: grid(25),
      conductivityWPerMK: grid(1),
      volumetricHeatCapacityJPerM3K: grid(1e6),
      heatGenerationWPerM3: grid(1000)
    });
    assert.strictEqual(unstable.status, 'INVALID_INPUT');
    assert.match(unstable.error.message, /stability limit/i);
  });

  // ----------------------------------------------------
  // Suite 6: Semiconductor & EDA (Logic Synthesis & Calibre DRC)
  // ----------------------------------------------------
  console.log('\n6. Testing Semiconductor & EDA Engines:');

  test('LogicSynthesisEngine: reports an experimental result for one supported Boolean assignment', () => {
    const verilog = `
    module simple_alu (
      input a, b,
      output y
    );
      assign y = a & b;
    endmodule
  `;

    const netlist = LogicSynthesisEngine.synthesize(verilog);
    assert.strictEqual(netlist.moduleName, 'simple_alu');
    assert.strictEqual(netlist.inputs.length, 2);
    assert.strictEqual(netlist.outputs.length, 1);
    assert.strictEqual(netlist.gateCount, 1);
    assert.strictEqual(netlist.gates[0].cell, 'AND2');
    assert(netlist.serialGateDelayEstimate_ps > 0);
    assert.strictEqual(netlist.timing.criticalPathDelay_ps, null);
    assert.strictEqual(netlist.timing.maxFrequency_MHz, null);
    assert.strictEqual(netlist.timing.timingSlack_ps, null);
    assert(netlist.area.totalArea_um2 > 0);
    assert.strictEqual(netlist.area.status, 'illustrative-uncharacterized-estimate');
  });

  test('Verilog IPC rejects empty/default input and unsupported expressions without fake timing', () => {
    const missing = handleVerilogSynthesisRequest('');
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.error.code, 'INVALID_INPUT');

    const supported = handleVerilogSynthesisRequest(`
      module m(input a, b, output y);
        assign y = a & b;
      endmodule
    `);
    assert.strictEqual(supported.success, true);
    assert.strictEqual(supported.maxFrequency_MHz, null);
    assert.strictEqual(supported.timingSlack_ps, null);

    const unsupported = handleVerilogSynthesisRequest(`
      module m(input a, b, output y);
        assign y = a + b;
      endmodule
    `);
    assert.strictEqual(unsupported.success, false);
    assert.strictEqual(unsupported.status, 'unavailable');
    assert.strictEqual(unsupported.error.code, 'UNSUPPORTED');

    const noLogic = handleVerilogSynthesisRequest('module declarations_only(input a, output y); endmodule');
    assert.strictEqual(noLogic.success, false);
    assert.strictEqual(noLogic.error.code, 'UNSUPPORTED');
  });

  test('SystemVerilog route labels declaration inspection and unavailable synthesis separately', () => {
    const invalid = handleSystemVerilogInspectionRequest('// module in a comment');
    assert.strictEqual(invalid.success, false);
    assert.strictEqual(invalid.error.code, 'INVALID_INPUT');

    const inspected = handleSystemVerilogInspectionRequest('module top(input logic a, output logic y); endmodule');
    assert.strictEqual(inspected.success, true);
    assert.strictEqual(inspected.operation, 'source-inspection');
    assert.strictEqual(inspected.synthesisStatus, 'unavailable');
    assert.strictEqual(inspected.inspection.moduleName, 'top');
    assert.strictEqual(inspected.technologyMapping.status, 'unavailable');
  });

  test('LEF and DEF routes reject unrecognized input instead of returning empty placeholder designs', () => {
    const lefInvalid = handleLefParseRequest({ content: 'this is not LEF' });
    assert.strictEqual(lefInvalid.success, false);
    assert.strictEqual(lefInvalid.status, 'invalid-input');

    const defInvalid = handleDefParseRequest({ content: 'this is not DEF' });
    assert.strictEqual(defInvalid.success, false);
    assert.strictEqual(defInvalid.status, 'invalid-input');

    const def = `VERSION 5.8 ;
DESIGN top ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 1000 1000 ) ;
COMPONENTS 0 ;
END COMPONENTS
NETS 0 ;
END NETS
END DESIGN`;
    assert.strictEqual(handleDefParseRequest({ content: def }).success, true);
    assert.strictEqual(
      handleDefSerializeRequest({
        defData: {
          name: 'top',
          unitsDistanceMicrons: 1000,
          dieArea: { x1: 0, y1: 0, x2: 1000, y2: 1000 },
          components: [],
          nets: []
        }
      }).success,
      true
    );
    assert.strictEqual(handleDefSerializeRequest({ defData: {} }).success, false);

    const missingPlacement = `VERSION 5.8 ;
DESIGN top ;
UNITS DISTANCE MICRONS 1000 ;
DIEAREA ( 0 0 ) ( 1000 1000 ) ;
COMPONENTS 1 ;
  - inst cell ;
END COMPONENTS
END DESIGN`;
    assert.strictEqual(handleDefParseRequest({ content: missingPlacement }).success, false);
  });

  test('MCMM and 3D PEX reject finite inputs that overflow calculated results', () => {
    const { MCMMStaticTimingEngine } = require('../src/core/eda/mcmm_sta_engine');
    const { ParasiticExtraction3D } = require('../src/core/eda/parasitic_extraction_3d');
    assert.throws(
      () =>
        MCMMStaticTimingEngine.runMCMMAnalysis({
          clockPeriodNs: Number.MIN_VALUE,
          logicDelayTypNs: 0,
          clockSkewNs: 0,
          tCqTypNs: 0,
          tSetupTypNs: 0,
          tHoldTypNs: 0,
          corners: [{ name: 'caller', voltage: 1, temperatureC: 25, processScale: 1 }]
        }),
      /non-finite/
    );
    assert.throws(
      () =>
        ParasiticExtraction3D.extractWireRC({
          lengthUm: Number.MAX_VALUE,
          widthUm: Number.MAX_VALUE,
          thicknessUm: Number.MAX_VALUE,
          spacingUm: Number.MAX_VALUE,
          dielectricHeightUm: Number.MAX_VALUE,
          dielectricPermittivity: Number.MAX_VALUE,
          resistivityOhmM: Number.MAX_VALUE
        }),
      /non-finite/
    );
  });

  test('LEF writer requires caller-supplied layer, cell, pin-use, and pin-rectangle records', () => {
    const { Sky130PdkAdapter } = require('../src/core/eda/sky130_pdk_adapter');
    const { getExperimentalEdaLibraryExample } = require('./support/experimental_eda_library_example');
    const library = getExperimentalEdaLibraryExample();
    const adapter = new Sky130PdkAdapter(library);
    const lef = adapter.generateLEF();
    const rect = library.cells.demo_inv.pins.A.rectUm.map((value) => value.toFixed(3)).join(' ');
    assert(lef.includes(`RECT ${rect} ;`));

    const missingRect = getExperimentalEdaLibraryExample();
    delete missingRect.cells.demo_inv.pins.A.rectUm;
    assert.throws(() => new Sky130PdkAdapter(missingRect), /four explicit rectUm coordinates/);
  });

  test('DRCEngine: experimental rectangle width, spacing, and area checks', () => {
    const shapes = [
      { id: 'poly1', layer: 'Poly', x: 0, y: 0, w: 30, h: 100 },
      { id: 'poly2', layer: 'Poly', x: 40, y: 0, w: 60, h: 100 }
    ];

    const drc = DRCEngine.runDRC(shapes, { minWidth: 50, minSpacing: 45, minArea: 2500 });
    assert.strictEqual(drc.isClean, false);
    assert(drc.violationCount >= 2);

    const widthViolations = drc.violations.filter((v) => v.type === 'MIN_WIDTH_VIOLATION');
    const spacingViolations = drc.violations.filter((v) => v.type === 'MIN_SPACING_VIOLATION');
    assert(widthViolations.length >= 1);
    assert(spacingViolations.length >= 1);
  });

  test('DRC rejects malformed rectangles, zero rule limits, and omitted route inputs', () => {
    const rules = { minWidth: 1, minSpacing: 1, minArea: 1 };
    const missing = handleDrcRequest({});
    assert.strictEqual(missing.success, false);
    assert.strictEqual(missing.error.code, 'INVALID_INPUT');

    const malformed = handleDrcRequest({
      shapes: [{ id: 'R1', layer: 'M1', x: 0, y: 0, w: Number.NaN, h: 5 }],
      rules
    });
    assert.strictEqual(malformed.success, false);
    assert.strictEqual(malformed.error.code, 'INVALID_INPUT');

    const disabledRules = DRCEngine.runDRC([{ id: 'R1', layer: 'M1', x: 0, y: 0, w: 5, h: 5 }], {
      minWidth: 0,
      minSpacing: 0,
      minArea: 0
    });
    assert.strictEqual(disabledRules.success, false);
    assert.strictEqual(disabledRules.error.code, 'INVALID_INPUT');

    const valid = handleDrcRequest({
      shapes: [{ id: 'R1', layer: 'M1', x: 0, y: 0, w: 5, h: 5 }],
      rules
    });
    assert.strictEqual(valid.success, true);
    assert.strictEqual(valid.clean, true);
    assert.strictEqual(valid.validationLevel, 'experimental');
  });

  test('DRCEngine: LVS experimental instance name and cell-type heuristic', () => {
    const schematic = {
      gates: [
        { id: 'U1', cell: 'NAND2' },
        { id: 'U2', cell: 'INV' }
      ]
    };
    const layout = {
      cells: [
        { id: 'C1', type: 'NAND2' },
        { id: 'C2', type: 'INV' }
      ]
    };

    const lvs = DRCEngine.runLVS(schematic, layout);
    assert.strictEqual(lvs.isLVSMatched, true);
    assert.strictEqual(lvs.matchedCount, 2);
    assert.strictEqual(lvs.validationLevel, 'experimental');
    assert.deepStrictEqual(lvs.unmatchedSchematic, []);
    assert.deepStrictEqual(lvs.unmatchedLayout, []);
  });

  test('DRCEngine: LVS rejects empty data and cannot reuse one extracted instance', () => {
    const empty = DRCEngine.runLVS({ gates: [] }, { cells: [] });
    assert.strictEqual(empty.success, false);
    assert.strictEqual(empty.isLVSMatched, false);
    assert.strictEqual(empty.error.code, 'INVALID_INPUT');

    const reused = DRCEngine.runLVS(
      {
        gates: [
          { id: 'U1', cell: 'INV' },
          { id: 'U2', cell: 'INV' }
        ]
      },
      { cells: [{ id: 'C1', type: 'INV' }] }
    );
    assert.strictEqual(reused.isLVSMatched, false);
    assert.deepStrictEqual(reused.unmatchedSchematic, ['U2']);
  });

  test('DRCEngine: LVS rejects unmatched extra layout instances', () => {
    const result = DRCEngine.runLVS(
      { gates: [{ id: 'U1', cell: 'INV' }] },
      {
        cells: [
          { id: 'C1', type: 'INV' },
          { id: 'C2', type: 'INV' }
        ]
      }
    );
    assert.strictEqual(result.isLVSMatched, false);
    assert.deepStrictEqual(result.unmatchedLayout, ['C2']);
  });

  // ----------------------------------------------------
  // Suite 7: Dynamic Simulink & Drone GNC Flight Dynamics
  // ----------------------------------------------------
  console.log('\n7. Testing Dynamic Simulink & Drone GNC Engines:');

  test('BlockDiagramGraph: caller-specified PID signal-chain smoke case', () => {
    const graph = new BlockDiagramGraph();
    const step = graph.addBlock('source_step', 'Step Target', { initialValue: 0.0, finalValue: 10.0, stepTime: 0.1 });
    const pid = graph.addBlock('pid', 'Attitude PID', { kp: 2.0, ki: 0.1, kd: 0.05, initialState: 0.0 });
    const plant = graph.addBlock('integrator', 'Plant Model', { initialState: 0.0 });
    const scope = graph.addBlock('scope', 'Signal Scope', {});

    graph.connect(step.id, pid.id);
    graph.connect(pid.id, plant.id);
    graph.connect(plant.id, scope.id);

    const res = graph.simulate(2.0, 0.01);
    assert(res.time.length > 100);
    assert(res.signals[scope.id].length === res.time.length);
  });

  test('BlockDiagramGraph: evaluates dependencies and preserves requested time precision', () => {
    const graph = BlockDiagramGraph.fromJSON({
      blocks: [
        { id: 'scope', type: 'scope', name: 'Output', params: {} },
        { id: 'gain', type: 'gain', name: 'Gain', params: { k: 2 } },
        { id: 'source', type: 'source_constant', name: 'Input', params: { value: 1 } }
      ],
      connections: [
        { id: 'gain-scope', fromBlock: 'gain', toBlock: 'scope' },
        { id: 'source-gain', fromBlock: 'source', toBlock: 'gain' }
      ]
    });
    const result = graph.simulate(0.0002, 0.00001);
    assert.strictEqual(result.time.length, 21);
    assert.strictEqual(result.time[1], 0.00001);
    assert(result.time[2] > result.time[1], 'Time samples must not collapse through display rounding');
    assert.deepStrictEqual(result.signals.scope, new Array(21).fill(2));
  });

  test('BlockDiagramGraph: rejects unsupported feedback cycles instead of returning stale values', () => {
    const graph = BlockDiagramGraph.fromJSON({
      blocks: [
        { id: 'left', type: 'gain', name: 'Left', params: { k: 1 } },
        { id: 'right', type: 'gain', name: 'Right', params: { k: 1 } }
      ],
      connections: [
        { id: 'left-right', fromBlock: 'left', toBlock: 'right' },
        { id: 'right-left', fromBlock: 'right', toBlock: 'left' }
      ]
    });
    assert.throws(() => graph.simulate(0.1, 0.1), /feedback loops are unsupported/i);
  });

  test('BlockDiagramGraph: rejects a request that exceeds its aggregate work budget', () => {
    const graph = new BlockDiagramGraph();
    for (let index = 0; index < 100; index++) graph.addBlock('source_constant', `Input ${index}`, { value: 1 });
    assert.throws(() => graph.simulate(10, 0.00001), /graph work or result-size budget/);
  });

  test('BlockDiagramGraph: reports non-finite arithmetic as a numerical failure', () => {
    const graph = BlockDiagramGraph.fromJSON({
      blocks: [
        { id: 'source', type: 'source_constant', params: { value: Number.MAX_VALUE } },
        { id: 'gain', type: 'gain', params: { k: Number.MAX_VALUE } }
      ],
      connections: [{ id: 'wire', fromBlock: 'source', toBlock: 'gain' }]
    });
    assert.throws(() => graph.simulate(0.1, 0.1), /non-finite output or state/);
  });

  test('BlockDiagramGraph: generated block and connection IDs are repeatable', () => {
    const createIds = () => {
      const graph = new BlockDiagramGraph();
      const source = graph.addBlock('source_constant', 'Input', { value: 1 });
      const scope = graph.addBlock('scope', 'Output', {});
      const connection = graph.connect(source.id, scope.id);
      return { blockIds: [source.id, scope.id], connectionId: connection.id };
    };
    assert.deepStrictEqual(createIds(), createIds());
  });

  test('BlockDiagramGraph: rejects missing block parameters and time controls', () => {
    const graph = new BlockDiagramGraph();
    graph.addBlock('source_step', 'Incomplete Step', {});
    assert.throws(() => graph.simulate(1.0, 0.01), /requires a finite 'stepTime' input/);
    assert.throws(() => new BlockDiagramGraph().simulate(), /requires positive finite tEnd and dt/);
  });

  test('QuadcopterDynamics: legacy illustrative trajectory has no stability verdict', () => {
    const res = QuadcopterDynamics.simulateFlightMission({
      targetAltitude: 10.0,
      windGustSpeed: 2.5,
      totalTime: 4.0,
      dt: 0.01
    });

    assert.strictEqual(res.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(res.validationLevel, 'experimental');
    assert.strictEqual(Object.hasOwn(res, 'settlingTime_s'), false);
    assert.strictEqual(Object.hasOwn(res, 'overshootPercent'), false);
    assert.strictEqual(Object.hasOwn(res, 'stabilityVerdict'), false);
    assert.strictEqual(res.targetAltitude, 10.0);
    assert(res.flightLog.length > 50);
    const finalLog = res.flightLog[res.flightLog.length - 1];
    // The numerical example advances toward its requested setpoint; this is not flight validation.
    assert(finalLog.altitude_m > 8.0, `Expected altitude > 8.0m, got ${finalLog.altitude_m}m`);
  });

  test('CFDSolver2D: static propeller coefficient estimate requires explicit unverified inputs', () => {
    const legacyCall = CFDSolver2D.solvePropellerThrust(8000, 5.0, 3.0);
    assert.strictEqual(legacyCall.success, false);
    assert.strictEqual(legacyCall.status, 'unavailable');
    assert.strictEqual(legacyCall.error.code, 'UNSUPPORTED');

    const incomplete = CFDSolver2D.solvePropellerThrust({ rpm: 7200, diameterM: 0.25 });
    assert.strictEqual(incomplete.status, 'invalid-input');
    assert.strictEqual(incomplete.error.code, 'INVALID_INPUT');

    const estimate = CFDSolver2D.solvePropellerThrust({
      rpm: 7200,
      diameterM: 0.25,
      airDensityKgM3: 1.2,
      thrustCoefficient: 0.08,
      torqueCoefficient: 0.01,
      coefficientSource: 'caller-supplied smoke fixture'
    });
    assert.strictEqual(estimate.success, true);
    assert.strictEqual(estimate.status, 'experimental');
    assert.strictEqual(estimate.validationLevel, 'experimental');
    assert.strictEqual(estimate.thrustN, 5.4);
    assert.ok(estimate.shaftPowerW > 0);
    assert.match(estimate.coefficientProvenance, /not independently verified/);
    assert.strictEqual(/CFD solve/i.test(estimate.model), false);
  });

  // ----------------------------------------------------
  // Suite 8: Oil & Gas (Thermodynamics & Piping Stress)
  // ----------------------------------------------------
  console.log('\n8. Testing Oil & Gas Process Simulation Engines:');

  test('ThermodynamicsEngine: experimental pure-component parameters & Wilson/RR VLE estimate', () => {
    const feed = { Methane: 0.2, Propane: 0.5, nPentane: 0.3 };
    const componentProperties = getExperimentalThermoProperties(Object.keys(feed));
    assert.deepStrictEqual(PURE_COMPONENTS, {});

    const pr = ThermodynamicsEngine.getPurePRParams('Propane', 300.0, componentProperties.Propane);
    assert(pr.a > 0);
    assert(pr.b > 0);
    assert.strictEqual(pr.validationLevel, 'experimental');
    assert.strictEqual(pr.dataStatus, 'caller-supplied-unverified-data');

    const flash = ThermodynamicsEngine.flashVLE(feed, 25.0, 5.0, componentProperties);
    assert.strictEqual(flash.validationLevel, 'experimental');
    assert.strictEqual(flash.model, 'Wilson K-value estimate with bracketed Rachford-Rice phase calculation');
    assert.strictEqual(flash.dataStatus, 'caller-supplied-unverified-data');
    assert(flash.vaporFraction >= 0 && flash.vaporFraction <= 1.0);
    assert(typeof flash.vaporComposition === 'object');
    assert(typeof flash.liquidComposition === 'object');
    for (const pseudoComponent of ['Naphtha', 'Kerosene', 'Diesel']) {
      assert.strictEqual(Object.hasOwn(PURE_COMPONENTS, pseudoComponent), false);
      assert.throws(
        () => ThermodynamicsEngine.getPurePRParams(pseudoComponent, 300),
        /Explicit property data is required/
      );
    }
    assert.throws(() => ThermodynamicsEngine.getPurePRParams('Unknown', 300), /Explicit property data is required/);
    assert.throws(() => ThermodynamicsEngine.flashVLE(feed, 25, 5), /Explicit component property records/);
    assert.throws(() => ThermodynamicsEngine.flashVLE(undefined, 25, 5, componentProperties), /feed composition/);
    assert.throws(
      () => ThermodynamicsEngine.flashVLE({ Methane: '0.2', Propane: 0.5, nPentane: 0.3 }, 25, 5, componentProperties),
      /mole fractions must be finite/
    );
  });

  test('ThermodynamicsEngine: crude distillation is unavailable without sourced model and reference', () => {
    const col = ThermodynamicsEngine.simulateDistillationColumn(50000, 30, 2.5);
    assert.strictEqual(col.success, false);
    assert.strictEqual(col.status, 'unavailable');
    assert.match(col.error, /No sourced assay/);
  });

  test('PipingStressEngine: experimental thermal stress example', () => {
    assert.deepStrictEqual(PIPING_MATERIALS, {}, 'Legacy material export remains present without unsourced records');
    assert.deepStrictEqual(ASME_PIPE_SCHEDULES, {}, 'Legacy schedule export remains present without unsourced records');
    assert(Object.isFrozen(PIPING_MATERIALS));
    assert(Object.isFrozen(ASME_PIPE_SCHEDULES));

    const explicitInputs = {
      pipeOuterDiameterMm: 219.1,
      nominalWallThicknessMm: 8.18,
      youngsModulusGPa: 200.0,
      thermalExpansionPerK: 1.2e-5,
      designPressureBar: 25.0,
      operatingTempC: 220.0,
      ambientTempC: 20.0,
      straightLengthM: 35.0,
      corrosionAllowanceMm: 1.6
    };

    const missingInputs = PipingStressEngine.evaluateASMEB313({ operatingTempC: 220.0 });
    assert.strictEqual(missingInputs.status, 'unavailable');
    assert.strictEqual(missingInputs.success, false);
    assert(missingInputs.missingInputs.includes('designPressureBar'));
    assert.match(missingInputs.error, /No calculation was run/);

    // Case A: With explicitly supplied loop geometry and material inputs.
    const resLoop = PipingStressEngine.evaluateASMEB313({
      ...explicitInputs,
      hasExpansionLoop: true,
      loopHeightM: 4.8,
      elbowCenterlineRadiusM: 0.32865
    });

    assert.strictEqual(resLoop.success, true);
    assert.strictEqual(resLoop.status, 'estimate');
    assert.strictEqual(resLoop.validationLevel, 'experimental');
    assert.strictEqual(resLoop.screeningStatus, 'EXPERIMENTAL_SCREENING_ONLY');
    assert.strictEqual(resLoop.dataStatus, 'user-supplied-unverified-inputs');
    assert.strictEqual(Object.hasOwn(resLoop, 'isCodeCompliant'), false);
    assert.strictEqual(Object.hasOwn(resLoop, 'stressRatio'), false);
    assert.strictEqual(Object.hasOwn(resLoop, 'allowableStress_SA_MPa'), false);
    assert(Number.isFinite(resLoop.expansionStress_MPa));

    // Case B: Straight pipe with no loop-specific geometry.
    const resNoLoop = PipingStressEngine.evaluateASMEB313({
      ...explicitInputs,
      hasExpansionLoop: false
    });

    assert.strictEqual(resNoLoop.success, true);
    assert.strictEqual(resNoLoop.validationLevel, 'experimental');
    assert.strictEqual(resNoLoop.screeningStatus, 'EXPERIMENTAL_SCREENING_ONLY');
    assert(Number.isFinite(resNoLoop.expansionStress_MPa));
    assert.strictEqual(Object.hasOwn(resNoLoop, 'stressRatio'), false);
    assert.strictEqual(
      PipingStressEngine.evaluateASMEB313({
        ...explicitInputs,
        hasExpansionLoop: false,
        pipeOuterDiameterMm: 0
      }).status,
      'invalid'
    );
  });

  // ----------------------------------------------------
  // Suite 9: OmniAI Co-Pilot & Dual Manual/AI Editing
  // ----------------------------------------------------
  console.log('\n9. Testing OmniAI Co-Pilot & Dual Manual/AI Synchronization:');

  test('OmniAIEngine: Tool catalog and prompt routing', () => {
    const ai = new OmniAIEngine();
    assert(OMNI_TOOLS.length >= 7);
    assert(!JSON.stringify(OMNI_TOOLS).includes('"default"'), 'Tool schemas must not inject engineering defaults');

    // Drop test prompt
    const pDrop = ai.processPrompt('Run a 2m drop test on the smartphone corner with a mass of 205 g');
    assert.strictEqual(pDrop.matchedTool, 'run_phone_drop_test');
    assert.strictEqual(pDrop.toolInput.dropHeight, 2.0);
    assert.strictEqual(pDrop.toolInput.phoneMass, 0.205);
    assert.strictEqual(pDrop.executionMode, 'legacy-keyword-macro');
    assert.strictEqual(pDrop.validationLevel, 'experimental');
    assert.strictEqual(pDrop.inputOrigin, 'user-prompt');
    assert(pDrop.assistantMessage.includes('mass'));
    assert(pDrop.assistantMessage.includes('not independently validated'));
    assert(pDrop.suggestedManualEdits.length > 0);
    assert.strictEqual(pDrop.suggestedManualEdits.find((edit) => edit.label === 'Device Mass')?.key, 'phoneMassKg');

    const pDropMissingMass = ai.processPrompt('Run a 2m drop test on the smartphone corner');
    assert.strictEqual(pDropMissingMass.result.status, 'INVALID_INPUT');
    assert.deepStrictEqual(pDropMissingMass.toolInput, {});
    assert.match(pDropMissingMass.assistantMessage, /mass.*kg|kg.*mass/i);

    const pDropMissingHeight = ai.processPrompt('Run a phone drop test with a mass of 205 g on the corner');
    assert.strictEqual(pDropMissingHeight.result.status, 'INVALID_INPUT');
    assert.deepStrictEqual(pDropMissingHeight.toolInput, {});
    assert.match(pDropMissingHeight.assistantMessage, /height.*m/i);

    const pDropMissingAngle = ai.processPrompt('Run a 2 m phone drop test with a mass of 205 g');
    assert.strictEqual(pDropMissingAngle.result.status, 'INVALID_INPUT');
    assert.deepStrictEqual(pDropMissingAngle.toolInput, {});
    assert.match(pDropMissingAngle.assistantMessage, /orientation/i);

    const pDropWizardMissingInputs = ai.processPrompt('Open the phone drop test wizard');
    assert.strictEqual(pDropWizardMissingInputs.result.status, 'INVALID_INPUT');
    assert.deepStrictEqual(pDropWizardMissingInputs.toolInput, {});

    const pDropWizard = ai.processPrompt(
      'Open the phone drop test wizard for a 1.5 m drop with a mass of 205 g on the corner'
    );
    assert.strictEqual(pDropWizard.result.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(pDropWizard.result.inputs.phoneMassKg, 0.205);
    assert.strictEqual(pDropWizard.inputOrigin, 'user-prompt');

    // Thermal prompt
    const pTherm = ai.processPrompt('Test smartphone thermal with vapor chamber at 9W');
    assert.strictEqual(pTherm.matchedTool, 'simulate_mobile_thermal');
    assert.deepStrictEqual(pTherm.result.status, 'UNAVAILABLE');
    assert.deepStrictEqual(pTherm.toolInput, {});
    assert.deepStrictEqual(pTherm.suggestedManualEdits, []);

    // Synthesis prompt
    const pSynth = ai.processPrompt('Synthesize 32-bit ALU verilog code');
    assert.strictEqual(pSynth.matchedTool, 'synthesize_verilog_chip');
    assert.strictEqual(pSynth.result.status, 'UNAVAILABLE');
    assert.deepStrictEqual(pSynth.toolInput, {});
    assert.strictEqual(pSynth.inputOrigin, 'none');

    const pSynthWithSource = ai.processPrompt(`Synthesize this Verilog:\n\`\`\`verilog
module simple_alu (input a, input b, output y);
  assign y = a & b;
endmodule
\`\`\``);
    assert.strictEqual(pSynthWithSource.matchedTool, 'synthesize_verilog_chip');
    assert.strictEqual(pSynthWithSource.result.moduleName, 'simple_alu');
    assert.strictEqual(pSynthWithSource.inputOrigin, 'user-prompt');

    // Drone GNC prompt
    const pDrone = ai.processPrompt('Fly drone to 15m altitude with wind');
    assert.strictEqual(pDrone.matchedTool, 'simulate_drone_flight');
    assert.strictEqual(pDrone.result.status, 'UNAVAILABLE');
    assert.deepStrictEqual(pDrone.toolInput, {});
    assert.strictEqual(pDrone.suggestedManualEdits.length, 0);

    const pDroneWizard = ai.processPrompt('Open the drone design wizard');
    assert.strictEqual(pDroneWizard.result.status, 'UNAVAILABLE');
    assert.deepStrictEqual(pDroneWizard.toolInput, { wizardType: 'drone' });
    assert.match(pDroneWizard.assistantMessage, /No drone sizing estimate was run/);

    // Piping stress prompt
    const pPipe = ai.processPrompt('Evaluate ASME piping stress at 250C with no loop');
    assert.strictEqual(pPipe.matchedTool, 'calculate_asme_piping_stress');
    assert.strictEqual(pPipe.toolInput.hasExpansionLoop, false);
    assert.strictEqual(pPipe.toolInput.operatingTempC, 250);
    assert.strictEqual(pPipe.result.status, 'unavailable');
    assert.strictEqual(pPipe.inputOrigin, 'user-prompt');
    assert.strictEqual(Object.hasOwn(pPipe.toolInput, 'designPressureBar'), false);

    const pGdt = ai.processPrompt('Evaluate GD&T true position at MMC');
    assert.strictEqual(pGdt.matchedTool, 'inspect_gdt_tolerance');
    assert.strictEqual(pGdt.result.status, 'UNAVAILABLE');
    assert.deepStrictEqual(pGdt.toolInput, {});
    assert.strictEqual(pGdt.inputOrigin, 'none');
    assert.match(pGdt.assistantMessage, /No calculation was run/);

    const noInputMacros = [
      ['Evaluate ASME Section VIII vessel stress', 'evaluate_asme_section_viii'],
      ['Heal imported CAD geometry', 'heal_cad_geometry'],
      ['Solve a geometric constraint sketch', 'solve_variational_sketch'],
      ['Compare two CAD revisions', 'diff_3d_cad_models'],
      ['Unfold this sheet metal part', 'unfold_sheet_metal'],
      ['Run sparse multifrontal Cholesky', 'solve_sparse_multifrontal'],
      ['Run GPU PCG on this system', 'solve_gpu_parallel_pcg'],
      ['Run FMI co-simulation', 'run_fmi_cosimulation'],
      ['Package the project archive', 'package_omni_archive'],
      ['Trace spot diagram and MTF', 'solve_skew_optics'],
      ['Run an SPICE transient', 'solve_spice_circuit'],
      ['Solve a process flowsheet', 'solve_flowsheet'],
      ['Export STEP', 'export_step'],
      ['Export Gerber', 'export_gerber']
    ];
    for (const [prompt, expectedTool] of noInputMacros) {
      const plan = ai.processPrompt(prompt);
      assert.strictEqual(plan.matchedTool, expectedTool, `Unexpected route for: ${prompt}`);
      assert.strictEqual(plan.result.status, 'UNAVAILABLE', `Macro ran without data: ${prompt}`);
      assert.deepStrictEqual(plan.toolInput, {}, `Macro applied hidden inputs: ${prompt}`);
      assert.strictEqual(plan.inputOrigin, 'none', `Macro provenance should be empty: ${prompt}`);
    }

    // Camera Lens Optics & 3D Cutaway prompt
    const pLensMissing = ai.processPrompt('Design a camera lens and show a cutaway');
    assert.strictEqual(pLensMissing.result.status, 'INVALID_INPUT');
    assert.deepStrictEqual(pLensMissing.suggestedManualEdits, []);
    assert.match(
      pLensMissing.assistantMessage,
      /focal length.*f-number.*subject distance.*wavelength.*circle of confusion/
    );

    const pLens = ai.processPrompt(
      'Estimate a 50mm f/1.4 lens focused at 2m using a 550 nm wavelength and a 0.029 mm circle of confusion; show the illustrative cutaway'
    );
    assert.strictEqual(pLens.matchedTool, 'design_camera_lens_optics');
    assert.strictEqual(pLens.toolInput.focalLengthMm, 50.0);
    assert.strictEqual(pLens.toolInput.fStop, 1.4);
    assert.strictEqual(pLens.toolInput.subjectDistM, 2.0);
    assert.strictEqual(pLens.toolInput.wavelengthNm, 550);
    assert.strictEqual(pLens.toolInput.circleOfConfusionMm, 0.029);
    assert.strictEqual(pLens.inputOrigin, 'user-prompt');
    assert(pLens.result.entrancePupilDiameterMm > 30.0);
    assert(pLens.result.airyDiskDiameterUm > 0.0);
    assert.match(pLens.assistantMessage, /50\s*mm/);
    assert(pLens.suggestedManualEdits.some((e) => e.key === 'lensFStop'));

    const pPcbMissing = ai.processPrompt('Open the PCB design wizard');
    assert.strictEqual(pPcbMissing.result.status, 'INVALID_INPUT');
    const pPcb = ai.processPrompt(
      'Open the 4-layer PCB wizard with 0.2 mm dielectric thickness, target impedance 50 ohm, er 4.4, and copper thickness 35 um'
    );
    assert.strictEqual(pPcb.result.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(pPcb.toolInput.inputs.copperThicknessMm, 0.035);
    assert.strictEqual(pPcb.inputOrigin, 'user-prompt');

    const pDistillation = ai.processPrompt('Run HYSYS crude distillation');
    assert.strictEqual(pDistillation.result.status, 'UNAVAILABLE');
    assert(pDistillation.assistantMessage.includes('No product yields or duties were calculated'));

    const pUnknown = ai.processPrompt('Please explain the project status');
    assert.strictEqual(pUnknown.matchedTool, null);
    assert.strictEqual(pUnknown.result, null);
    assert(pUnknown.assistantMessage.includes('No geometry or engineering calculation was created'));
  });

  // ----------------------------------------------------
  // Suite 10: Synthetic Experimental Sample Templates
  // ----------------------------------------------------
  console.log('\n10. Testing Experimental Synthetic Sample Templates:');

  test('Community Samples: Every template identifies synthetic provenance and experimental maturity', () => {
    assert(COMMUNITY_SAMPLES.length >= 8, `Expected at least 8 samples, got ${COMMUNITY_SAMPLES.length}`);
    const industries = new Set(COMMUNITY_SAMPLES.map((s) => s.industry));
    assert(industries.has('Consumer Electronics'));
    assert(industries.has('Semiconductor & EDA'));
    assert(industries.has('Drone & Aerospace'));
    assert(industries.has('Oil & Gas'));

    COMMUNITY_SAMPLES.forEach((s) => {
      assert(s.id && s.title && s.studio && s.description);
      assert(Array.isArray(s.tags) && s.tags.length > 0);
      assert.strictEqual(s.sampleType, 'synthetic-example');
      assert.strictEqual(s.validationLevel, 'experimental');
      assert(s.provenance.includes('no independent source or validation'));
    });

    const plantStreamSample = COMMUNITY_SAMPLES.find((sample) => sample.id === 'sample_crude_distillation_unit');
    assert(plantStreamSample, 'Expected the illustrative plant stream template to remain available');
    assert(
      Math.abs(Object.values(plantStreamSample.feedComposition).reduce((sum, fraction) => sum + fraction, 0) - 1) <
        1e-12
    );
    assert(Object.keys(plantStreamSample.feedComposition).every((component) => typeof component === 'string'));
    assert.deepStrictEqual(PURE_COMPONENTS, {}, 'Synthetic sample components are not backed by a product database.');
  });

  // ----------------------------------------------------
  // Suite 11: Cloud-Native HPC Cluster & Engineering Audit
  // ----------------------------------------------------
  console.log('\n11. Testing Cloud-Native HPC Cluster & Technical Audit Engine:');

  test('CloudHPCEngine: Unconfigured scheduler fails closed without fabricated telemetry', () => {
    const hpc = new CloudHPCEngine();

    const initialStatus = hpc.getClusterStatus();
    assert.strictEqual(initialStatus.success, false);
    assert.strictEqual(initialStatus.configured, false);
    assert.strictEqual(initialStatus.membershipActive, undefined);
    assert.strictEqual(initialStatus.status, 'UNCONFIGURED');
    assert.strictEqual(initialStatus.specs, undefined);
    assert.strictEqual(initialStatus.nodesSample, undefined);
    assert.strictEqual(initialStatus.error.code, 'UNSUPPORTED');

    const deniedJob = hpc.submitSimulationJob('FEA_DROP_TEST', {}, 32);
    assert.strictEqual(deniedJob.success, false);
    assert.strictEqual(deniedJob.error.code, 'UNSUPPORTED');
    assert.strictEqual(hpc.computeDomainDecomposition(250000, 32).success, false);
    assert.strictEqual(hpc.setMembership(true).success, false);
  });

  test('AuditReportGenerator: Rejects incomplete evidence and derives experimental maturity', () => {
    const incomplete = AuditReportGenerator.generateComprehensiveReport({
      projectId: 'project-1',
      projectName: 'Test project'
    });
    assert.strictEqual(incomplete.success, false);
    assert.strictEqual(incomplete.error.code, 'INVALID_INPUT');

    const evidence = {
      projectId: 'project-1',
      projectName: 'Test project',
      projectRevision: 'r1',
      engineVersion: 'test-engine',
      dependencyVersions: { 'test-runtime': '1.0.0' },
      inputs: [{ hash: 'sha256:test-input', units: 'm' }],
      results: [
        {
          domain: 'cad',
          name: 'test result',
          units: 'm',
          value: 1,
          projectRevision: 'r1',
          engineVersion: 'test-engine',
          backendVersion: 'legacy-js-test-adapter',
          dependencyVersions: { 'test-engine': '1.0.0' },
          convergenceDiagnostics: {
            status: 'not-applicable',
            reason: 'Static report fixture; no numerical solve was run.',
            residuals: []
          },
          warnings: [],
          inputHashes: ['sha256:test-input']
        }
      ],
      assumptions: [],
      warnings: []
    };
    const report = AuditReportGenerator.generateComprehensiveReport(evidence);
    assert.strictEqual(report.success, true);
    assert.strictEqual(report.report.validationLevel, 'experimental');
    assert.strictEqual(report.report.results[0].validationLevel, 'experimental');
    assert(!report.htmlReport.includes('CERTIFIED'));
    assert(!report.htmlReport.includes('COMPLIANT'));
    assert(report.htmlReport.includes('does not make certification or compliance claims'));
    assert(report.htmlReport.includes('sha256:test-input'));

    const callerMaturityClaim = AuditReportGenerator.generateComprehensiveReport({
      ...evidence,
      results: [{ ...evidence.results[0], validationLevel: 'released' }]
    });
    assert.strictEqual(callerMaturityClaim.success, true);
    assert.strictEqual(callerMaturityClaim.report.results[0].validationLevel, 'experimental');

    const missingDependencyVersions = AuditReportGenerator.generateComprehensiveReport({
      ...evidence,
      dependencyVersions: undefined
    });
    assert.strictEqual(missingDependencyVersions.success, false);
    assert.strictEqual(missingDependencyVersions.error.code, 'INVALID_INPUT');

    const emptyDependencyVersions = AuditReportGenerator.generateComprehensiveReport({
      ...evidence,
      dependencyVersions: {}
    });
    assert.strictEqual(emptyDependencyVersions.success, false);
    assert.strictEqual(emptyDependencyVersions.error.code, 'INVALID_INPUT');

    const emptyResultDependencies = AuditReportGenerator.generateComprehensiveReport({
      ...evidence,
      results: [{ ...evidence.results[0], dependencyVersions: {} }]
    });
    assert.strictEqual(emptyResultDependencies.success, false);
    assert.strictEqual(emptyResultDependencies.error.code, 'INVALID_INPUT');

    const oversizedEvidence = AuditReportGenerator.generateComprehensiveReport({
      ...evidence,
      results: [{ ...evidence.results[0], value: 'x'.repeat(1024 * 1024) }]
    });
    assert.strictEqual(oversizedEvidence.success, false);
    assert.strictEqual(oversizedEvidence.error.code, 'RESOURCE_EXHAUSTED');

    const unlinkedResult = AuditReportGenerator.generateComprehensiveReport({
      ...evidence,
      results: [{ ...evidence.results[0], inputHashes: ['sha256:missing-input'] }]
    });
    assert.strictEqual(unlinkedResult.success, false);
    assert.strictEqual(unlinkedResult.error.code, 'INVALID_INPUT');

    const missingDiagnostics = AuditReportGenerator.generateComprehensiveReport({
      ...evidence,
      results: [{ ...evidence.results[0], convergenceDiagnostics: undefined }]
    });
    assert.strictEqual(missingDiagnostics.success, false);
    assert.strictEqual(missingDiagnostics.error.code, 'INVALID_INPUT');

    const mismatchedRevision = AuditReportGenerator.generateComprehensiveReport({
      ...evidence,
      results: [{ ...evidence.results[0], projectRevision: 'r0' }]
    });
    assert.strictEqual(mismatchedRevision.success, false);
    assert.strictEqual(mismatchedRevision.error.code, 'INVALID_INPUT');
  });

  // ----------------------------------------------------
  // Suite 12: Material Library, Transient Dynamics & Frequency Response
  // ----------------------------------------------------
  console.log('\n12. Testing Material Library, Transient Dynamics & Frequency Analysis:');

  test('MaterialManager: unavailable records fail closed without fallback properties', () => {
    assert.deepStrictEqual(MATERIAL_DATABASE, {});
    assert(Object.isFrozen(MATERIAL_DATABASE));
    assert.deepStrictEqual(MaterialManager.listAllMaterials(), []);
    assert.strictEqual(MaterialManager.getMaterial('Ti-6Al-4V_Grade5'), null);
    assert.strictEqual(MaterialManager.getMaterial('unknown-material'), null);
    assert.strictEqual(MaterialManager.getMaterial('toString'), null);
    assert.throws(
      () => MaterialManager.computeInertiaCuboid('unknown-material', 0.075, 0.0082, 0.16),
      /material property data is unavailable/i
    );
    assert.throws(
      () => MaterialManager.computeInertiaCuboid(),
      /material property data is unavailable/i,
      'Missing material and dimensions must not select implicit defaults'
    );

    const estimate = MaterialManager.computeCuboidMassProperties({
      widthM: 0.075,
      heightM: 0.0082,
      depthM: 0.16,
      densityKgM3: 2700,
      densitySource: 'caller test input'
    });
    assert.strictEqual(estimate.validationLevel, 'experimental');
    assert.strictEqual(estimate.model, 'Homogeneous solid cuboid');
    assert.strictEqual(estimate.results.volumeM3, 0.075 * 0.0082 * 0.16);
    assert.strictEqual(estimate.results.massKg, estimate.results.volumeM3 * 2700);
    assert.strictEqual(estimate.inputs.densitySource, 'caller test input');
    assert.throws(
      () =>
        MaterialManager.computeCuboidMassProperties({
          widthM: 0.1,
          heightM: 0.1,
          depthM: 0.1,
          densityKgM3: 0,
          densitySource: 'source'
        }),
      /explicit finite positive values/i
    );
    assert.throws(
      () =>
        MaterialManager.computeCuboidMassProperties({
          widthM: 0.1,
          heightM: 0.1,
          depthM: 0.1,
          densityKgM3: 1000,
          densitySource: ' '
        }),
      /density source/i
    );
  });

  test('TransientDropAnimator: experimental impact history and energy fields', () => {
    const sim = TransientDropAnimator.solveTransientHistory({
      dropHeightM: 1.5,
      phoneMassKg: 0.205,
      impactAngle: 'corner',
      totalDurationMs: 5.0,
      stepCount: 50
    });

    assert.strictEqual(sim.frames.length, 51);
    assert.strictEqual(sim.validationLevel, 'experimental');
    assert.strictEqual(sim.screeningStatus, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert.strictEqual(sim.status, 'EXPERIMENTAL_ESTIMATE_ONLY');
    assert(sim.impactVelocity_m_s > 5.0 && sim.impactVelocity_m_s < 6.0);
    assert(sim.peakDeceleration_G > 50.0);
    assert(sim.peakContactResponseIndex > 0.0);
    assert.strictEqual(sim.inputs.phoneMassKg, 0.205);
    assert(sim.modelAssumptions.contactStiffnessNPerM > 0);
    assert.strictEqual(sim.modelAssumptions.gravityMPerS2, 9.80665);
    assert.throws(
      () =>
        TransientDropAnimator.solveTransientHistory({
          dropHeightM: 1.5,
          phoneMassKg: 0.205,
          impactAngle: 'corner'
        }),
      /totalDurationMs.*stepCount/i
    );
    assert.throws(() => TransientDropAnimator.solveTransientHistory(), /dropHeightM.*phoneMassKg.*impactAngle/i);
    assert.throws(
      () =>
        TransientDropAnimator.solveTransientHistory({
          dropHeightM: 1.5,
          phoneMassKg: 0.205,
          impactAngle: 'corner',
          totalDurationMs: 5,
          stepCount: 10001
        }),
      /stepCount between 1 and 10000/i
    );
    assert.strictEqual(Object.hasOwn(sim, 'verdict'), false);
    assert.strictEqual(Object.hasOwn(sim, 'safetyFactor'), false);
    assert.strictEqual(Object.hasOwn(sim, 'glassCrackDetected'), false);
    assert.strictEqual(Object.hasOwn(sim, 'chassisPlasticDeformation'), false);

    // Check energy conservation across frames
    const midFrame = sim.frames[25];
    assert(midFrame.totalEnergy_J > 0.0);
    assert(typeof midFrame.kineticEnergy_J === 'number');
    assert(typeof midFrame.strainEnergy_J === 'number');
    assert(typeof midFrame.dissipatedEnergy_J === 'number');
  });

  test('FrequencyResponseAnalyzer: MATLAB/Simulink Bode magnitude, phase and stability margins', () => {
    // G(s) = 10 / (s^2 + 2s + 10)
    assert.throws(() => FrequencyResponseAnalyzer.computeBode(), /requires finite numerator/);
    const bode = FrequencyResponseAnalyzer.computeBode([10], [1, 2, 10], 0.1, 100, 50);

    assert.strictEqual(bode.bodePoints.length, 50);
    assert.strictEqual(bode.validationLevel, 'experimental');
    assert.strictEqual(bode.marginAssessment, 'NOT_PERFORMED');
    assert.strictEqual(Object.hasOwn(bode, 'isStable'), false);
    assert.strictEqual(Object.hasOwn(bode, 'stabilityVerdict'), false);

    // DC Gain should be 10/10 = 1.0 (0 dB)
    const dcPoint = bode.bodePoints[0];
    assert(Math.abs(dcPoint.magnitudeDb - 0.0) < 1.0);
    assert(dcPoint.phaseDeg < 5.0 && dcPoint.phaseDeg > -15.0);
  });

  test('VLEPhaseEnvelopeEngine: Wilson/Rachford-Rice estimate is labeled; fabricated tray profile is unavailable', () => {
    const composition = { Methane: 0.2, Propane: 0.5, nPentane: 0.3 };
    const componentProperties = getExperimentalThermoProperties(Object.keys(composition));
    const envelope = VLEPhaseEnvelopeEngine.generatePTEnvelope(
      composition,
      1.0,
      50.0,
      20,
      componentProperties,
      -40,
      160
    );
    assert.strictEqual(envelope.points.length, 20);
    assert.strictEqual(envelope.validationLevel, 'experimental');
    assert.strictEqual(envelope.dataStatus, 'caller-supplied-unverified-data');
    assert.match(envelope.model, /Wilson K-value estimates/);
    assert.strictEqual(envelope.sampledPressureMaxBar, 50.0);
    assert(
      envelope.points.some((point) => point.status === 'unavailable'),
      'Unbracketed saturation estimates must be reported as unavailable.'
    );
    assert(
      envelope.points.every((point) =>
        point.status === 'unavailable'
          ? point.twoPhaseWidthC === null
          : Number.isFinite(point.bubblePointTempC) && Number.isFinite(point.dewPointTempC)
      )
    );
    assert(envelope.sampledDewPointMaxC === null || Number.isFinite(envelope.sampledDewPointMaxC));
    assert.strictEqual(Object.hasOwn(envelope, 'criticalPoint'), false);
    assert.throws(() => VLEPhaseEnvelopeEngine.generatePTEnvelope(), /explicit non-empty component composition/);
    assert.throws(
      () => VLEPhaseEnvelopeEngine.generatePTEnvelope(composition, 1.0, 50.0, 20),
      /Explicit component property records/
    );
    assert.throws(
      () => VLEPhaseEnvelopeEngine.generatePTEnvelope(composition, 1.0, 50.0, 20, componentProperties),
      /Explicit temperature bounds/
    );

    const column = VLEPhaseEnvelopeEngine.generateColumnTrayProfile(30, 22, 50000);
    assert.strictEqual(column.success, false);
    assert.strictEqual(column.status, 'unavailable');
    assert.strictEqual(column.validationLevel, 'experimental');
    assert.match(column.error.message, /sourced crude assay/);
    assert.strictEqual(Object.hasOwn(column, 'trays'), false);
  });

  // ----------------------------------------------------
  console.log('\n13. Testing Camera Lens Optics & Optomechanics Engine:');

  test('OpticalEngine: test-only prescription exercises explicit surface conversion', () => {
    assert.throws(() => OpticalEngine.get50mmPrescription(), /No source-reviewed 50 mm prescription is bundled/);
    const rx = OpticalEngine.get50mmPrescription(opticalExamples.illustrativePrescription);
    assert.strictEqual(rx.focalLengthMm, 50.0);
    assert.strictEqual(rx.designAperture, 1.4);
    assert.strictEqual(rx.groups.length, 6);
    assert.strictEqual(rx.elements.length, 8);

    // Legacy data are isolated in test support; production only accepts explicit records.
    rx.elements.forEach((elem) => {
      assert(elem.thicknessMm > 0);
      assert(elem.clearApertureMm > 0);
      assert(elem.opticalMaterial);
      assert(elem.refractiveIndex_nd > 1.4 && elem.refractiveIndex_nd < 1.9);
      assert(elem.abbeNumber_Vd > 20 && elem.abbeNumber_Vd < 100);
    });
    assert(OpticalEngine.getOpticalSurfaces(rx).length >= 10);
  });

  test('OpticalEngine: solveOpticalMetrics requires explicit wavelength and circle of confusion', () => {
    assert.throws(() => OpticalEngine.solveOpticalMetrics(50.0, 1.4, 2.0), /wavelengthNm, and circleOfConfusionMm/);
    const m14 = OpticalEngine.solveOpticalMetrics(50.0, 1.4, 2.0, 550, 0.029);
    assert.strictEqual(m14.entrancePupilDiameterMm, 35.71);
    assert.strictEqual(m14.numericalAperture, 0.3571);
    // Airy disk: 2.44 * 0.550 * 1.4 = 1.88 um
    assert.strictEqual(m14.diffractionAiryDiskDiameter_um, 1.88);
    assert.strictEqual(m14.circleOfConfusionMm, 0.029);
    assert(m14.hyperfocalDistance_m > 60.0 && m14.hyperfocalDistance_m < 65.0);
    assert(m14.depthOfField_m > 0.1 && m14.depthOfField_m < 0.2);
    assert(m14.nearFocusLimit_m < 2.0 && m14.farFocusLimit_m > 2.0);

    // Test smaller aperture f/8.0
    const m8 = OpticalEngine.solveOpticalMetrics(50.0, 8.0, 2.0, 550, 0.029);
    assert.strictEqual(m8.entrancePupilDiameterMm, 6.25);
    // Depth of field should be much larger at f/8 than f/1.4
    assert(m8.depthOfField_m > m14.depthOfField_m);
    // Airy disk should be larger at f/8 (diffraction limit increases)
    assert(m8.diffractionAiryDiskDiameter_um > m14.diffractionAiryDiskDiameter_um);
    assert(m8.mtf50ResolutionLimit_lp_per_mm < m14.mtf50ResolutionLimit_lp_per_mm);
  });

  test('OpticalEngine: ray trace runs only from explicit prescription and ray inputs', () => {
    const trace = OpticalEngine.traceExactSkewRays(opticalExamples.illustrativePrescription, {
      fStop: 1.4,
      fieldAngleDeg: 0,
      numRings: 1,
      raysPerRing: 5,
      wavelengthUm: 0.58756,
      pupilPlaneZMm: -10,
      sensorZMm: 75,
      maxFrequencyLpMm: 120
    });
    assert(trace.rayCount > 0);
    assert.strictEqual(trace.pupilPlaneZMm, -10);
    assert.strictEqual(trace.mtf.cutoffFreqLpMm, 1216);
    assert.strictEqual(trace.validationLevel, 'experimental');
    const missingPupilPlaneOptions = {
      fStop: 1.4,
      fieldAngleDeg: 0,
      numRings: 1,
      raysPerRing: 5,
      wavelengthUm: 0.58756,
      sensorZMm: 75,
      maxFrequencyLpMm: 120
    };
    assert.throws(
      () => OpticalEngine.traceExactSkewRays(opticalExamples.illustrativePrescription, missingPupilPlaneOptions),
      /pupil plane/i
    );
    assert.throws(() => OpticalEngine.traceRays(), /explicit optical prescription/);
  });

  // ----------------------------------------------------
  // Suite 14: Experimental implementation Gap Closure Engines
  // ----------------------------------------------------
  const { runIndustrialTests } = require('./test_industrial_gap_closure');
  const indStats = runIndustrialTests();
  totalTests += indStats.total;
  passedTests += indStats.passed;
  failedTests += indStats.failed;

  // ----------------------------------------------------
  // Suite 15: Phase 1 Upgrade Master Plan Engines
  // ----------------------------------------------------
  const { runPhase1Tests } = require('./test_phase1_upgrade');
  const p1Stats = runPhase1Tests();
  totalTests += p1Stats.total;
  passedTests += p1Stats.passed;
  failedTests += p1Stats.failed;

  // ----------------------------------------------------
  // Suite 16: Phase 2 Upgrade Master Plan Engines (CAD Kernel)
  // ----------------------------------------------------
  const { runPhase2Tests } = require('./test_phase2_upgrade');
  const p2Stats = runPhase2Tests();
  totalTests += p2Stats.total;
  passedTests += p2Stats.passed;
  failedTests += p2Stats.failed;

  // ----------------------------------------------------
  // Suite 17: Phase 3 Upgrade Master Plan Engines (Structural & Fluid Mechanics)
  // ----------------------------------------------------
  const { runPhase3Tests } = require('./test_phase3_upgrade');
  const p3Stats = runPhase3Tests();
  totalTests += p3Stats.testsPassed + p3Stats.testsFailed;
  passedTests += p3Stats.testsPassed;
  failedTests += p3Stats.testsFailed;

  // ----------------------------------------------------
  // Suite 18: Phase 4 Upgrade Master Plan Engines (EDA & High-Order Optics)
  // ----------------------------------------------------
  const { runPhase4Tests } = require('./test_phase4_upgrade');
  const p4Stats = runPhase4Tests();
  totalTests += p4Stats.testsPassed + p4Stats.testsFailed;
  passedTests += p4Stats.testsPassed;
  failedTests += p4Stats.testsFailed;

  // ----------------------------------------------------
  // Suite 19: Phase 5 legacy module smoke checks (GNC and plant)
  // ----------------------------------------------------
  const { runPhase5Tests } = require('./test_phase5_upgrade');
  const p5Stats = runPhase5Tests();
  totalTests += p5Stats.testsPassed + p5Stats.testsFailed;
  passedTests += p5Stats.testsPassed;
  failedTests += p5Stats.testsFailed;

  // ----------------------------------------------------
  // Suite 20: Legacy engineering module smoke checks; not independent validation
  // ----------------------------------------------------
  const { runGoldBenchmarks } = require('./test_gold_benchmarks');
  const goldStats = runGoldBenchmarks();
  totalTests += goldStats.passedCount + goldStats.failedCount;
  passedTests += goldStats.passedCount;
  failedTests += goldStats.failedCount;

  // ----------------------------------------------------
  // Suite 21: Experimental legacy module smoke checks (phases 6-13)
  // ----------------------------------------------------
  const { runAllGoldBenchmarks2 } = require('./test_gold_benchmarks_2');
  const gold2Stats = runAllGoldBenchmarks2();
  totalTests += gold2Stats.total;
  passedTests += gold2Stats.passed;
  failedTests += gold2Stats.total - gold2Stats.passed;

  // ----------------------------------------------------
  // Suite 22: Experimental legacy module smoke checks (former suite 3)
  // ----------------------------------------------------
  const { runGoldRegulatoryBenchmarks3 } = require('./test_gold_benchmarks_3');
  const gold3Stats = runGoldRegulatoryBenchmarks3();
  totalTests += gold3Stats.total;
  passedTests += gold3Stats.passed;
  failedTests += gold3Stats.total - gold3Stats.passed;

  // ----------------------------------------------------
  // Suite 23: Experimental legacy module smoke checks (former suite 23)
  // ----------------------------------------------------
  const { runTier1CommercialProductionTests } = require('./test_tier1_commercial_production');
  const tier1Stats = await runTier1CommercialProductionTests();
  totalTests += tier1Stats.total;
  passedTests += tier1Stats.passed;
  failedTests += tier1Stats.total - tier1Stats.passed;

  // ----------------------------------------------------
  // Suite 24: Experimental security and math helper smoke checks
  // ----------------------------------------------------
  const { runTier1TenOutOfTenTests } = require('./test_tier1_10_out_of_10');
  const tenOutOfTenStats = runTier1TenOutOfTenTests();
  totalTests += tenOutOfTenStats.total;
  passedTests += tenOutOfTenStats.passed;
  failedTests += tenOutOfTenStats.total - tenOutOfTenStats.passed;

  // ----------------------------------------------------
  // Suite 25: Deterministic parser input robustness smoke checks
  // ----------------------------------------------------
  const { runParserFuzzTests } = require('./fuzz/test_parsers_fuzz');
  const fuzzStats = runParserFuzzTests();
  totalTests += fuzzStats.total;
  passedTests += fuzzStats.passed;
  failedTests += fuzzStats.total - fuzzStats.passed;

  // ----------------------------------------------------
  // Suite 26: Experimental numerical diagnostics; unavailable cases remain visible but are not failed solves
  // ----------------------------------------------------
  const { runVVVerificationBenchmarks } = require('./vv/run_vv');
  const vvStats = runVVVerificationBenchmarks();
  totalTests += vvStats.total - vvStats.unavailable;
  passedTests += vvStats.passed;
  failedTests += vvStats.failed;
  unavailableValidationCases += vvStats.unavailable;

  // ----------------------------------------------------
  // Suite 27: Legacy feature smoke checks
  // ----------------------------------------------------
  const { runIndustrialGapClosureTests } = require('./test_new_industrial_engines');
  const gapStats = runIndustrialGapClosureTests();
  totalTests += gapStats.total;
  passedTests += gapStats.passed;
  failedTests += gapStats.total - gapStats.passed;

  // ----------------------------------------------------
  // Suite 28: Synthetic camera-lens design example smoke checks; no commercial comparison
  // ----------------------------------------------------
  const { runCameraLensMasterTests } = require('./test_camera_lens_master');
  const lensStats = runCameraLensMasterTests();
  totalTests += lensStats.total;
  passedTests += lensStats.passed;
  failedTests += lensStats.total - lensStats.passed;

  // ----------------------------------------------------
  // Suite 29: Anatomy Craft plugin integration smoke checks
  // ----------------------------------------------------
  const { runAnatomyCraftParityTests } = require('./test_anatomy_craft_parity');
  const anatomyStats = runAnatomyCraftParityTests();
  totalTests += anatomyStats.total;
  passedTests += anatomyStats.passed;
  failedTests += anatomyStats.total - anatomyStats.passed;

  // ----------------------------------------------------
  // Suite 30: Experimental multi-physics module smoke checks
  // ----------------------------------------------------
  const { runIndustrialMasterEnginesTests } = require('./test_industrial_master_engines');
  const industrialStats = runIndustrialMasterEnginesTests();
  totalTests += industrialStats.total;
  passedTests += industrialStats.passed;
  failedTests += industrialStats.total - industrialStats.passed;

  // ----------------------------------------------------
  // Suite 31: Illustrative aerospace calculation smoke checks
  // ----------------------------------------------------
  const { runNasaRocketPropulsionTests } = require('./test_nasa_rocket_propulsion');
  const nasaStats = runNasaRocketPropulsionTests();
  totalTests += nasaStats.total;
  passedTests += nasaStats.passed;
  failedTests += nasaStats.total - nasaStats.passed;

  // ----------------------------------------------------
  // Suite 32: Experimental PFD preservation checks
  // ----------------------------------------------------
  const { runFlowsheetPfdUITests } = require('./test_flowsheet_pfd_ui');
  const flowsheetPfdStats = runFlowsheetPfdUITests();
  totalTests += flowsheetPfdStats.total;
  passedTests += flowsheetPfdStats.passed;
  failedTests += flowsheetPfdStats.total - flowsheetPfdStats.passed;

  // ----------------------------------------------------
  // Summary
  // ----------------------------------------------------
  await Promise.all(pendingTests);
  await new Promise((resolve) => setImmediate(resolve));
  process.removeListener('unhandledRejection', onUnhandledRejection);
  for (const reason of unhandledRejections) {
    totalTests++;
    failedTests++;
    console.error('  ✗ FAIL: unhandled rejection during test run');
    console.error(`    ${reason?.stack || reason}`);
  }

  console.log('\n====================================================');
  console.log(
    `Experimental smoke assertions: ${passedTests}/${totalTests} passed; ${unavailableValidationCases} validation cases unavailable; ${failedTests} failed`
  );
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exitCode = 1;
  } else {
    console.log('All selected OmniEng test assertions passed.\n');
  }
}

runAllTests().catch((err) => {
  console.error('Unhandled test runner failure:', err);
  process.exitCode = 1;
});
