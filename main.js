/**
 * OmniEng Main Process (Electron Application)
 * Connects high-performance native simulation engines, local file systems, and IPC bridges.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Core Engines
const { Vector3, Quaternion } = require('./src/core/math/linear_algebra');
const { BRepPrimitives } = require('./src/core/cad/brep_topology');
const { FeatureTree, ParametricFeature } = require('./src/core/cad/feature_tree');
const { DropTestSimulator } = require('./src/core/cae/drop_test');
const { CFDSolver2D } = require('./src/core/cae/cfd_navier_stokes');
const { ThermalEngine } = require('./src/core/cae/thermal_cht');
const { LogicSynthesisEngine } = require('./src/core/eda/logic_synthesis');
const { DRCEngine } = require('./src/core/eda/drc_engine');
const { BlockDiagramGraph } = require('./src/core/dynamic_simulink/block_graph');
const { QuadcopterDynamics } = require('./src/core/dynamic_simulink/drone_flight_dynamics');
const { ThermodynamicsEngine } = require('./src/core/plant/thermodynamics');
const { PipingStressEngine } = require('./src/core/plant/piping_stress');
const { OmniAIEngine } = require('./src/core/ai/omni_ai_engine');
const { CloudHPCEngine } = require('./src/core/hpc/cloud_cluster');
const { AuditReportGenerator } = require('./src/core/reporting/audit_report');
const { MaterialManager } = require('./src/core/materials/material_database');
const { TransientDropAnimator } = require('./src/core/cae/transient_drop_animator');
const { FrequencyResponseAnalyzer } = require('./src/core/dynamic_simulink/frequency_analysis');
const { VLEPhaseEnvelopeEngine } = require('./src/core/plant/vle_envelope');
const { OpticalEngine } = require('./src/core/optics/optical_engine');
const { COMMUNITY_SAMPLES } = require('./src/samples/community_samples');

// Industrial Parity Gap Closure Engines
const { StepTranslator } = require('./src/core/cad/step_translator');
const { GerberExporter } = require('./src/core/eda/gerber_exporter');
const { SkewRayTracer } = require('./src/core/optics/skew_ray_tracer');
const { SpiceEngine } = require('./src/core/eda/spice_engine');
const { ProcessStream, ProcessFlowsheetSolver } = require('./src/core/plant/process_flowsheet_solver');
const { SymbolicReasoner } = require('./src/core/ai/symbolic_reasoner');
const { OmniArchive, CommandJournal } = require('./src/core/storage/omni_archive');
const { DropTestWizard, DroneDesignWizard, CameraLensWizard, PCBDesignWizard } = require('./src/ui/wizards/design_wizards');

// Phase 2 CAD Kernel & Modeling Parity Engines
const { NurbsBasis, NurbsCurve, NurbsSurface, SurfaceSurfaceIntersection } = require('./src/core/cad/nurbs_engine');
const { EdgeBlender } = require('./src/core/cad/edge_blender');
const { AssemblyComponent, AssemblyMateSolver } = require('./src/core/cad/assembly_mates');
const { FeatureControlFrame, DraftingEngine2D } = require('./src/core/cad/drafting_2d');

// Phase 3 Structural Mechanics & Fluid Multiphysics Engines
const { Point3D, Tetrahedron, DelaunayMesher3D } = require('./src/core/cae/delaunay_mesher_3d');
const { QuadraticTet10Element, MortarContactPair3D, LanczosModalEigensolver } = require('./src/core/cae/continuum_plasticity_3d');
const { FVMNavierStokes3D } = require('./src/core/cae/fvm_navier_stokes_3d');

const aiEngine = new OmniAIEngine();
const hpcEngine = new CloudHPCEngine();
const symbolicReasoner = new SymbolicReasoner();
const designWizards = {
  drop_test: new DropTestWizard(),
  drone: new DroneDesignWizard(),
  camera_lens: new CameraLensWizard(),
  pcb: new PCBDesignWizard()
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'OmniEng — Universal Engineering & Simulation Platform',
    backgroundColor: '#090d16',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableWebSQL: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  // Register All IPC Handlers

  // 1. Consumer Electronics: Drop Test & Thermal CHT
  ipcMain.handle('omni:solve-drop-test', async (event, params) => {
    return DropTestSimulator.runSimulation(params);
  });

  ipcMain.handle('omni:solve-thermal', async (event, params) => {
    return ThermalEngine.simulateSmartphoneThermal(params);
  });

  // 2. Semiconductor & EDA: Synthesis, DRC & LVS
  ipcMain.handle('omni:synthesize-verilog', async (event, source) => {
    return LogicSynthesisEngine.synthesize(source);
  });

  ipcMain.handle('omni:run-drc', async (event, { shapes, rules }) => {
    return DRCEngine.runDRC(shapes, rules);
  });

  ipcMain.handle('omni:run-lvs', async (event, { schematic, layout }) => {
    return DRCEngine.runLVS(schematic, layout);
  });

  // 3. Drone & Aerospace: CFD & Flight Dynamics
  ipcMain.handle('omni:solve-cfd', async (event, params = {}) => {
    const { nx = 40, ny = 30, aoaDeg = 4.0, velocity = 15.0 } = params;
    const cfd = new CFDSolver2D(nx, ny);
    cfd.setAirfoilObstacle(0.4, 0.12, aoaDeg);
    return cfd.solve(velocity, 120);
  });

  ipcMain.handle('omni:solve-propeller', async (event, params = {}) => {
    const { rpm = 8000, diameterInches = 5.0, pitchInches = 3.0 } = params;
    return CFDSolver2D.solvePropellerThrust(rpm, diameterInches, pitchInches);
  });

  ipcMain.handle('omni:simulate-drone', async (event, params) => {
    return QuadcopterDynamics.simulateFlightMission(params);
  });

  // 4. Oil & Gas Process: Thermodynamics & Piping Stress
  ipcMain.handle('omni:solve-hysys-flash', async (event, params = {}) => {
    const { feedComposition = { Methane: 0.2, Propane: 0.5, nPentane: 0.3 }, tempC = 25, pressureBar = 5 } = params;
    return ThermodynamicsEngine.flashVLE(feedComposition, tempC, pressureBar);
  });

  ipcMain.handle('omni:simulate-distillation', async (event, params = {}) => {
    const { feedBPD = 50000, trayCount = 30, refluxRatio = 2.5 } = params;
    return ThermodynamicsEngine.simulateDistillationColumn(feedBPD, trayCount, refluxRatio);
  });

  ipcMain.handle('omni:evaluate-piping-stress', async (event, params) => {
    return PipingStressEngine.evaluateASMEB313(params);
  });

  // 5. Universal CAD & Dynamic Systems
  ipcMain.handle('omni:create-cad-primitive', async (event, { type, params }) => {
    let body;
    if (type === 'cylinder') {
      body = BRepPrimitives.createCylinder(params.radius || 15, params.height || 40);
    } else if (type === 'sphere') {
      body = BRepPrimitives.createSphere(params.radius || 20);
    } else {
      body = BRepPrimitives.createBox(params.width || 60, params.height || 40, params.depth || 80);
    }
    return {
      id: body.id,
      name: body.name,
      volume: body.computeVolume(),
      triangles: body.toTriangles(),
      bbox: body.getBoundingBox()
    };
  });

  ipcMain.handle('omni:simulate-block-diagram', async (event, { graphData, tEnd, dt }) => {
    const graph = BlockDiagramGraph.fromJSON(graphData);
    return graph.simulate(tEnd || 10.0, dt || 0.01);
  });

  // 6. OmniAI Assistant
  ipcMain.handle('omni:ai-process-prompt', async (event, { prompt, context }) => {
    return aiEngine.processPrompt(prompt, context);
  });

  // 7. Community Samples & Export
  ipcMain.handle('omni:get-community-samples', async () => {
    return COMMUNITY_SAMPLES;
  });

  ipcMain.handle('omni:export-cad-obj', async (event, bodyData) => {
    const body = BRepPrimitives.createBox(bodyData.width || 50, bodyData.height || 30, bodyData.depth || 80);
    return body.toOBJ();
  });

  ipcMain.handle('omni:get-system-info', async () => {
    return {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      memoryGB: Math.round(os.totalmem() / (1024 ** 3)),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      tier: 'Local Workstation (Air-Gapped)'
    };
  });

  // 8. Cloud-Native HPC Cluster (Membership Tier)
  ipcMain.handle('omni:get-cluster-status', async () => {
    return hpcEngine.getClusterStatus();
  });

  ipcMain.handle('omni:set-membership', async (event, active) => {
    return hpcEngine.setMembership(active);
  });

  ipcMain.handle('omni:submit-hpc-job', async (event, { jobType, params, ranks }) => {
    return hpcEngine.submitSimulationJob(jobType, params, ranks);
  });

  // 9. Comprehensive Engineering Audit & Technical Report
  ipcMain.handle('omni:generate-audit-report', async (event, context) => {
    return AuditReportGenerator.generateComprehensiveReport(context);
  });

  // 10. Engineering Materials Database
  ipcMain.handle('omni:get-materials-list', async () => {
    return MaterialManager.listAllMaterials();
  });

  ipcMain.handle('omni:compute-inertia', async (event, { matKey, widthM, heightM, depthM }) => {
    return MaterialManager.computeInertiaCuboid(matKey, widthM, heightM, depthM);
  });

  // 11. Advanced Transient Dynamics & Frequency Analysis
  ipcMain.handle('omni:solve-transient-drop', async (event, params) => {
    return TransientDropAnimator.solveTransientHistory(params);
  });

  ipcMain.handle('omni:solve-bode', async (event, { numCoeffs, denCoeffs, omegaMin, omegaMax, points }) => {
    return FrequencyResponseAnalyzer.computeBode(numCoeffs, denCoeffs, omegaMin, omegaMax, points);
  });

  // 12. Advanced Chemical Process Thermodynamics
  ipcMain.handle('omni:get-vle-envelope', async (event, { composition, pMinBar, pMaxBar, points }) => {
    return VLEPhaseEnvelopeEngine.generatePTEnvelope(composition, pMinBar, pMaxBar, points);
  });

  ipcMain.handle('omni:get-column-profile', async (event, { trayCount, feedTray, feedBPD }) => {
    return VLEPhaseEnvelopeEngine.generateColumnTrayProfile(trayCount, feedTray, feedBPD);
  });

  // 13. Camera Lens Optics & Optomechanics
  ipcMain.handle('omni:solve-optics', async (event, params = {}) => {
    const { focalLengthMm = 50.0, fStop = 1.4, subjectDistM = 2.0 } = params;
    return OpticalEngine.solveOpticalMetrics(focalLengthMm, fStop, subjectDistM);
  });

  ipcMain.handle('omni:trace-rays', async (event, params = {}) => {
    const { fStop = 1.4, rayCount = 9 } = params;
    return OpticalEngine.traceRays(fStop, rayCount);
  });

  ipcMain.handle('omni:get-lens-prescription', async () => {
    return OpticalEngine.get50mmPrescription();
  });

  // 14. Industrial Parity Engines: Skew Optics, STEP, Gerber, SPICE, Flowsheet
  ipcMain.handle('omni:solve-skew-optics', async (event, params = {}) => {
    const surfaces = OpticalEngine.getOpticalSurfaces();
    const epRadius = params.entrancePupilRadius || 10.0;
    const bundle = SkewRayTracer.generateEntrancePupilRayGrid(epRadius, 0.5875618, 3, 8);
    const traced = SkewRayTracer.traceRayBundle(surfaces, bundle, 75.0);
    const spotData = SkewRayTracer.computeSpotDiagram(traced, 75.0);
    const mtfData = SkewRayTracer.computeMTFCurve(spotData.rmsRadiusMm, params.fStop || 1.4, 120);
    return { surfaces, spotData, mtfData, aperture: params.fStop || 1.4 };
  });

  ipcMain.handle('omni:export-step', async (event, bodyData = {}) => {
    const width = bodyData.width || 40;
    const height = bodyData.height || 60;
    const depth = bodyData.depth || 20;
    const name = bodyData.name || 'OmniEng_Component';
    const box = BRepPrimitives.createBox(width, height, depth, name);
    const stepText = StepTranslator.exportSTEP(box);
    return { success: true, stepText, filename: `${name}.step` };
  });

  ipcMain.handle('omni:export-gerber', async (event, pcbData = {}) => {
    const pkg = GerberExporter.generatePackage(pcbData.traces, pcbData.pads, pcbData.vias, pcbData.boardOutline);
    return { success: true, package: pkg, filename: 'OmniEng_Gerber_RS274X.zip' };
  });

  ipcMain.handle('omni:solve-spice-circuit', async (event, netlist = {}) => {
    const spice = new SpiceEngine();
    spice.addVoltageSource('V1', 'in', '0', 5.0);
    spice.addResistor('R1', 'in', 'out', 1000.0);
    spice.addCapacitor('C1', 'out', '0', 1e-6);
    const trans = spice.runTransient(0.006, 0.00005);
    return {
      success: true,
      transient: trans,
      circuitName: 'RC Low-Pass Filter Step Response (R=1kΩ, C=1µF, τ=1.0ms)'
    };
  });

  ipcMain.handle('omni:solve-flowsheet', async (event, config = {}) => {
    const flowsheet = new ProcessFlowsheetSolver();
    const feed = new ProcessStream('S1', {
      temperatureC: 25.0,
      pressureBar: 20.0,
      molarFlowKmolHr: 100.0,
      composition: { Methane: 0.7, Ethane: 0.2, Propane: 0.1 }
    });
    flowsheet.addStream(feed);
    flowsheet.addMixer('MIX1', ['S1', 'S_RECYCLE'], 'S2');
    flowsheet.addFlashDrum('FLASH1', 'S2', 'S_VAPOR', 'S_LIQ', { temperatureC: -20.0, pressureBar: 18.0 });
    flowsheet.addSplitter('SPLIT1', 'S_LIQ', 'S_PRODUCT', 'S_RECYCLE', { splitRatio: 0.7 });
    const solution = flowsheet.solveWithWegstein(50, 1e-4);
    return { success: true, solution };
  });

  // Universal Usability & Phase 1 Archive & Wizard IPC Handlers
  ipcMain.handle('omni:package-omni-archive', async (event, params = {}) => {
    const archive = new OmniArchive({
      projectName: params.projectName || 'OmniEng_Project',
      engineeringDomain: params.engineeringDomain || 'universal'
    });
    if (params.sections) {
      for (const [secName, secData] of Object.entries(params.sections)) {
        archive.addSection(secName, secData);
      }
    }
    const buf = archive.saveToBuffer();
    return {
      success: true,
      sizeBytes: buf.length,
      sectionCount: archive.listSections().length,
      sections: archive.listSections(),
      filename: `${params.projectName || 'project'}.omni`
    };
  });

  ipcMain.handle('omni:load-omni-archive', async (event, filePath) => {
    try {
      const archive = OmniArchive.loadFromFile(filePath);
      return {
        success: true,
        manifest: archive.manifest,
        sections: archive.listSections()
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('omni:run-design-wizard', async (event, { wizardType, inputs = {} }) => {
    const wizard = designWizards[wizardType];
    if (!wizard) {
      return { success: false, error: `Unknown wizard type: ${wizardType}` };
    }
    const result = wizard.runWizard(inputs);
    return { success: true, result };
  });

  ipcMain.handle('omni:self-heal-design', async (event, { currentDesign, safetyFactor = 1.5 }) => {
    const result = symbolicReasoner.selfHealStructuralYield(currentDesign, safetyFactor);
    return { success: true, result };
  });

  // Phase 2 CAD Kernel & Modeling Parity IPC Handlers
  ipcMain.handle('omni:evaluate-nurbs', async (event, params = {}) => {
    const { degree = 3, controlPoints = [], u = 0.5 } = params;
    const curve = new NurbsCurve({ degree, controlPoints });
    const point = curve.evaluate(u);
    const tangent = curve.evaluateTangent(u);
    const length = curve.computeLength(40);
    return { success: true, point: point.toArray(), tangent: tangent.toArray(), length };
  });

  ipcMain.handle('omni:intersect-nurbs-ssi', async (event, params = {}) => {
    const surf1 = NurbsSurface.createPlane(
      new Vector3(0, 0, params.z1 || 5),
      new Vector3(1, 0, 0),
      new Vector3(0, 1, 0),
      params.width1 || 20,
      params.height1 || 20
    );
    const surf2 = NurbsSurface.createPlane(
      new Vector3(0, params.y2 || 10, 0),
      new Vector3(1, 0, 0),
      new Vector3(0, 0, 1),
      params.width2 || 20,
      params.height2 || 20
    );
    const ssi = SurfaceSurfaceIntersection.intersect(surf1, surf2, {
      subdivisions: params.subdivisions || 8,
      tolerance: params.tolerance || 1e-4
    });
    return {
      success: true,
      pointCount: ssi.points.length,
      points: ssi.points.map(p => p.toArray()),
      curveLength: ssi.curveLength
    };
  });

  ipcMain.handle('omni:apply-edge-blend', async (event, params = {}) => {
    const { type = 'fillet', width = 20, height = 20, depth = 20, radius = 2.0, distance = 2.0 } = params;
    const solid = BRepPrimitives.createBox(width, height, depth);
    const targetEdge = solid.edges[0];
    if (type === 'chamfer') {
      const res = EdgeBlender.applyChamfer(solid, targetEdge, distance);
      return { success: true, type: 'chamfer', bevelArea: res.bevelArea, solidVolume: solid.computeVolume() };
    } else {
      const res = EdgeBlender.applyFillet(solid, targetEdge, radius);
      return { success: true, type: 'fillet', blendFacesCount: res.blendFacesCount, filletSurfaceArea: res.filletSurfaceArea };
    }
  });

  ipcMain.handle('omni:solve-assembly-mates', async (event, params = {}) => {
    const solver = new AssemblyMateSolver();
    const base = new AssemblyComponent('comp_base', 'BasePlate', { fixed: true });
    const part = new AssemblyComponent('comp_part', 'MountedPart', {
      position: new Vector3(params.initX || 5, params.initY || 5, params.initZ || 20),
      fixed: false
    });
    solver.addComponent(base);
    solver.addComponent(part);
    solver.addConcentric('comp_base', new Vector3(0, 0, 0), new Vector3(0, 0, 1), 'comp_part', new Vector3(0, 0, 0), new Vector3(0, 0, 1));
    solver.addCoincidentPlanes('comp_base', new Vector3(0, 0, params.targetZ || 10), new Vector3(0, 0, 1), 'comp_part', new Vector3(0, 0, 0), new Vector3(0, 0, -1));
    const result = solver.solve(params.maxIter || 40, 1e-4);
    return { success: true, result };
  });

  ipcMain.handle('omni:generate-drafting-sheet', async (event, params = {}) => {
    const solid = BRepPrimitives.createBox(params.width || 40, params.height || 25, params.depth || 15);
    solid.name = params.partName || 'BracketMount';
    const sheet = DraftingEngine2D.generateDrawingSheet(solid, {
      title: params.partName || 'Bracket Mounting Base',
      partNumber: params.partNumber || 'OE-BKT-001',
      gdtSpecs: [
        { characteristic: 'FLATNESS', tolerance: 0.02, datumPrimary: 'A' },
        { characteristic: 'POSITION', tolerance: 0.05, diameter: true, modifier: 'M', datumPrimary: 'A', datumSecondary: 'B' }
      ]
    });
    return { success: true, svg: sheet.svg, sheetWidth: sheet.sheetWidth, sheetHeight: sheet.sheetHeight };
  });

  // Phase 3 Structural Mechanics & Fluid Multiphysics IPC Handlers
  ipcMain.handle('omni:mesh-delaunay-3d', async (event, params = {}) => {
    const mesher = new DelaunayMesher3D({ targetEdgeLength: params.targetEdgeLength || 0.1 });
    const vertices = (params.vertices || []).map((v, i) => new Point3D(v.x, v.y, v.z, i));
    const faces = params.faces || [];
    const mesh = mesher.meshClosedSurface(vertices, faces, { quadratic: params.quadratic === true });
    return { success: true, mesh };
  });

  ipcMain.handle('omni:solve-continuum-plasticity-3d', async (event, params = {}) => {
    const tet = new QuadraticTet10Element(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], params.material || {});
    const gp = tet.gaussPoints[0];
    const strainInc = new Float64Array(params.strainIncrement || [0.01, -0.003, -0.003, 0, 0, 0]);
    const result = tet.radialReturnMapping(gp, strainInc, params.strainRate || 1.0, params.temperature || 293.15);
    return { success: true, result, gaussPoint: { vonMises: result.vonMises, isPlastic: result.isPlastic, ep: gp.equivalentPlasticStrain } };
  });

  ipcMain.handle('omni:solve-fvm-cfd-3d', async (event, params = {}) => {
    const fvm = new FVMNavierStokes3D({ omegaMRF: params.omegaMRF || { x: 0, y: 0, z: 0 } });
    const domain = fvm.createBoxDomain(params.nx || 6, params.ny || 6, params.nz || 4, params.lx || 1.0, params.ly || 0.8, params.lz || 0.6);
    const result = fvm.step(params.inletVelocity || 15.0, params.steps || 5);
    return { success: true, domain, result };
  });

  const win = createWindow();

  win.webContents.on('console-message', (e, level, msg, line, src) => {
    console.log(`[Renderer Console lvl=${level}] ${msg} (${src}:${line})`);
  });

  if (process.argv.includes('--test-ui')) {
    const rendererErrors = [];
    win.webContents.on('console-message', (e, level, msg, line, src) => {
      // Level 3 = error
      if (level >= 3 && !msg.includes('favicon')) {
        rendererErrors.push({ level, msg, line, src });
      }
    });

    win.webContents.on('did-finish-load', async () => {
      console.log('\n====================================================');
      console.log('   OmniEng Electron UI & Headless Integration Test');
      console.log('====================================================');
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      await sleep(1500);

      try {
        const testResults = await win.webContents.executeJavaScript(`
          (async () => {
            const results = [];
            function assert(cond, name) {
              results.push({ name, passed: !!cond });
              if (!cond) console.error('Assertion failed: ' + name);
            }

            // 1. Verify UI Buttons and Modals exist
            assert(!!document.getElementById('ribbon-btn-optics'), 'Ribbon button: Optics exists');
            assert(!!document.getElementById('ribbon-btn-scope'), 'Ribbon button: Scope exists');
            assert(!!document.getElementById('ribbon-btn-pfd'), 'Ribbon button: PFD exists');
            assert(!!document.getElementById('ribbon-btn-step'), 'Ribbon button: STEP exists');
            assert(!!document.getElementById('ribbon-btn-gerber'), 'Ribbon button: Gerber exists');
            assert(!!document.getElementById('modal-optical-inspector'), 'Modal: Optical Inspector exists');
            assert(!!document.getElementById('modal-spice-oscilloscope'), 'Modal: SPICE Oscilloscope exists');
            assert(!!document.getElementById('modal-flowsheet-pfd'), 'Modal: Flowsheet PFD exists');

            // 2. Test Optical Inspector
            document.getElementById('ribbon-btn-optics').click();
            await new Promise(r => setTimeout(r, 600));
            assert(document.getElementById('modal-optical-inspector').classList.contains('active'), 'Optical modal opens active');
            assert(!!document.getElementById('canvas-spot-diagram'), 'Optical Spot Diagram canvas rendered');
            assert(!!document.getElementById('canvas-mtf-curve'), 'Optical MTF chart canvas rendered');
            document.getElementById('btn-close-optical-inspector').click();
            assert(!document.getElementById('modal-optical-inspector').classList.contains('active'), 'Optical modal closes');

            // 3. Test SPICE Oscilloscope
            document.getElementById('ribbon-btn-scope').click();
            await new Promise(r => setTimeout(r, 600));
            assert(document.getElementById('modal-spice-oscilloscope').classList.contains('active'), 'Oscilloscope modal opens active');
            assert(!!document.getElementById('canvas-oscilloscope-screen'), 'Oscilloscope DSO waveform canvas rendered');
            document.getElementById('btn-close-spice-oscilloscope').click();
            assert(!document.getElementById('modal-spice-oscilloscope').classList.contains('active'), 'Oscilloscope modal closes');

            // 4. Test Flowsheet PFD
            document.getElementById('ribbon-btn-pfd').click();
            await new Promise(r => setTimeout(r, 600));
            assert(document.getElementById('modal-flowsheet-pfd').classList.contains('active'), 'Flowsheet modal opens active');
            const streamRows = document.querySelectorAll('.flowsheet-pfd-layout table tbody tr');
            assert(streamRows.length >= 4, 'Flowsheet stream summary table populated with streams');
            document.getElementById('btn-close-flowsheet-pfd').click();
            assert(!document.getElementById('modal-flowsheet-pfd').classList.contains('active'), 'Flowsheet modal closes');

            // 5. Test STEP and Gerber API invocations
            const stepRes = await window.omniEngAPI.exportSTEP({ width: 30, height: 50, depth: 15 });
            assert(stepRes && stepRes.success && stepRes.stepText.includes('ISO-10303-21'), 'IPC exportSTEP generates valid ISO-10303-21 string');

            const gerberRes = await window.omniEngAPI.exportGerber({
              traces: [{ net: 'SIG', x1: 5, y1: 5, x2: 25, y2: 5, widthMm: 0.2 }],
              pads: [], vias: [], boardOutline: { xMin: 0, yMin: 0, xMax: 50, yMax: 50 }
            });
            assert(gerberRes && gerberRes.success && gerberRes.package['TopCopper.gtl'].includes('%FSLAX25Y25*%'), 'IPC exportGerber generates RS-274X Extended format');

            // 6. Test OmniAI live auto-remediation
            window.omniAutoRemediate('param', 'lensFStop', 2.8);
            assert(true, 'window.omniAutoRemediate executed without error');

            // 7. Test Phase 1 Universal Wizards & .omni Container
            assert(!!document.getElementById('ribbon-btn-wizards'), 'Ribbon button: Wizards exists');
            assert(!!document.getElementById('ribbon-btn-omni-archive'), 'Ribbon button: .omni Archive exists');
            const wizardRes = await window.omniEngAPI.runDesignWizard('drone', { payloadKg: 0.3, propellerDiameterInches: 5.0 });
            assert(wizardRes && wizardRes.success && wizardRes.result.flightSpecs.rotorCount === 4, 'IPC runDesignWizard executes Drone wizard');

            const archiveRes = await window.omniEngAPI.packageOmniArchive({
              projectName: 'TestProject',
              sections: { info: { author: 'OmniEng' } }
            });
            assert(archiveRes && archiveRes.success && archiveRes.sizeBytes > 50, 'IPC packageOmniArchive builds compressed container');

            // 8. Test Phase 2 2D Drafting, Edge Blender, and Assembly Mates
            assert(!!document.getElementById('ribbon-btn-drafting'), 'Ribbon button: 2D Drafting exists');
            assert(!!document.getElementById('ribbon-btn-blend'), 'Ribbon button: Fillet/Chamfer exists');
            assert(!!document.getElementById('ribbon-btn-assembly'), 'Ribbon button: Assembly Mates exists');

            const draftingRes = await window.omniEngAPI.generateDraftingSheet({ width: 35, height: 25, depth: 15 });
            assert(draftingRes && draftingRes.success && draftingRes.svg.includes('<svg'), 'IPC generateDraftingSheet produces SVG drawing sheet');

            const blendRes = await window.omniEngAPI.applyEdgeBlend({ type: 'fillet', radius: 2.0 });
            assert(blendRes && blendRes.success && blendRes.blendFacesCount > 0, 'IPC applyEdgeBlend generates rolling-ball fillet');

            const mateRes = await window.omniEngAPI.solveAssemblyMates({ targetZ: 10.0 });
            assert(mateRes && mateRes.success && mateRes.result.rank > 0, 'IPC solveAssemblyMates resolves 6-DOF constraints');

            // 9. Test Phase 3 Structural & Fluid Mechanics
            assert(!!document.getElementById('ribbon-btn-mesher'), 'Ribbon button: 3D Mesher exists');
            assert(!!document.getElementById('ribbon-btn-fvm-cfd'), 'Ribbon button: 3D CFD exists');

            const meshRes = await window.omniEngAPI.meshDelaunay3D({
              vertices: [
                { x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, { x: 0.1, y: 0.1, z: 0 }, { x: 0, y: 0.1, z: 0 },
                { x: 0, y: 0, z: 0.1 }, { x: 0.1, y: 0, z: 0.1 }, { x: 0.1, y: 0.1, z: 0.1 }, { x: 0, y: 0.1, z: 0.1 }
              ],
              faces: [
                [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6],
                [0, 5, 1], [0, 4, 5], [2, 7, 3], [2, 6, 7],
                [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2]
              ],
              quadratic: true
            });
            assert(meshRes && meshRes.success && meshRes.mesh.type === 'TET10', 'IPC meshDelaunay3D generates TET10 quadratic mesh');

            const cfdRes = await window.omniEngAPI.solveFvmCFD3D({ inletVelocity: 20.0, steps: 3 });
            assert(cfdRes && cfdRes.success && cfdRes.result.maxVelocity > 0, 'IPC solveFvmCFD3D executes 3D polyhedral FVM step');

            return results;
          })();
        `);

        let allPassed = true;
        for (const res of testResults) {
          if (res.passed) {
            console.log(`  ✓ ${res.name}`);
          } else {
            console.error(`  ✗ ${res.name}`);
            allPassed = false;
          }
        }

        if (rendererErrors.length > 0) {
          console.error('\nRenderer Console Errors Detected:');
          for (const err of rendererErrors) {
            console.error(`  - [lvl=${err.level}] ${err.msg} (${err.src}:${err.line})`);
          }
          allPassed = false;
        } else {
          console.log('  ✓ 0 Renderer console errors detected');
        }

        console.log('====================================================');
        if (allPassed) {
          console.log('UI & Electron Integration Tests: ALL PASSED');
          console.log('====================================================\n');
          app.exit(0);
        } else {
          console.error('UI & Electron Integration Tests: FAILED');
          console.log('====================================================\n');
          app.exit(1);
        }
      } catch (err) {
        console.error('Test execution error:', err);
        app.exit(1);
      }
    });
  }

  if (process.argv.includes('--capture')) {
    win.webContents.on('did-finish-load', async () => {
      console.log('[OmniEng Capture] WebContents loaded. Preparing showcase...');
      const outputDir = process.env.CAPTURE_OUTPUT_DIR || path.join(__dirname, 'screenshots');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const sleep = ms => new Promise(r => setTimeout(r, ms));
      await sleep(1800);

      // Switch to 50mm Lens Cutaway
      await win.webContents.executeJavaScript(`
        (() => {
          const btn = document.getElementById('subtab-lens');
          if (btn) btn.click();
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, 10);
            window.viewport3D.cameraAngle = { theta: 0.55, phi: 0.75 };
            window.viewport3D.cameraDistance = 145;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(2000);

      // Shot 1: Full App UI
      console.log('[OmniEng Capture] Capturing full application UI...');
      const fullApp = await win.capturePage();
      fs.writeFileSync(path.join(outputDir, 'omnieng_camera_lens_app_ui.png'), fullApp.toPNG());

      // Get canvas rect
      const canvasRect = await win.webContents.executeJavaScript(`
        (() => {
          const el = document.getElementById('three-canvas');
          const r = el.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
        })();
      `);

      // Shot 2: 3D Viewport Inside Cutaway (Rear / Sensor & Master Group)
      console.log('[OmniEng Capture] Capturing 3D viewport inside cutaway (Rear / Sensor)...');
      const cutaway3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_cutaway_inside.png'), cutaway3D.toPNG());

      // Shot 2B: 3D Viewport Front Entrance Pupil Cutaway (Front Aspheric, Crown & Doublet)
      console.log('[OmniEng Capture] Capturing 3D viewport front entrance cutaway...');
      await win.webContents.executeJavaScript(`
        (() => {
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, -5);
            window.viewport3D.cameraAngle = { theta: 2.45, phi: 0.85 };
            window.viewport3D.cameraDistance = 140;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(1000);
      const frontCutaway3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_cutaway_front_iso.png'), frontCutaway3D.toPNG());

      // Shot 2C: 3D Cross-Sectional Profile Inspection (Full Optomechanical Optical Train)
      console.log('[OmniEng Capture] Capturing full optomechanical cross-section profile...');
      await win.webContents.executeJavaScript(`
        (() => {
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, 10);
            window.viewport3D.cameraAngle = { theta: 1.35, phi: 0.82 };
            window.viewport3D.cameraDistance = 145;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(1000);
      const profile3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_cross_section_profile.png'), profile3D.toPNG());

      // Shot 3: Exploded View
      console.log('[OmniEng Capture] Setting exploded view 65%...');
      await win.webContents.executeJavaScript(`
        (() => {
          const slider = document.getElementById('lens-explode-slider');
          if (slider) {
            slider.value = 65;
            slider.dispatchEvent(new Event('input'));
          }
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, 10);
            window.viewport3D.cameraAngle = { theta: 0.65, phi: 0.85 };
            window.viewport3D.cameraDistance = 210;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(1200);
      const exploded3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_exploded_view.png'), exploded3D.toPNG());

      // Shot 4: Closed f/16 Aperture
      console.log('[OmniEng Capture] Setting f/16 aperture...');
      await win.webContents.executeJavaScript(`
        (() => {
          const slider = document.getElementById('lens-explode-slider');
          if (slider) {
            slider.value = 0;
            slider.dispatchEvent(new Event('input'));
          }
          const sel = document.getElementById('lens-fstop');
          if (sel) {
            sel.value = '16';
            sel.dispatchEvent(new Event('change'));
          }
          if (window.viewport3D) {
            window.viewport3D.target.set(0, 0, 4);
            window.viewport3D.cameraAngle = { theta: 0.50, phi: 0.65 };
            window.viewport3D.cameraDistance = 115;
            window.viewport3D.updateCameraPosition();
          }
        })();
      `);
      await sleep(1200);
      const f16_3D = await win.capturePage(canvasRect);
      fs.writeFileSync(path.join(outputDir, 'camera_lens_aperture_f16.png'), f16_3D.toPNG());

      console.log('[OmniEng Capture] All showcase screenshots saved to:', outputDir);
      app.quit();
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
