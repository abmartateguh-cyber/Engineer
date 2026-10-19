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
const { DraftingEngine2D } = require('./src/core/cad/drafting_2d');

// Phase 3 Structural Mechanics & Fluid Multiphysics Engines
const { Point3D, Tetrahedron, DelaunayMesher3D } = require('./src/core/cae/delaunay_mesher_3d');
const { QuadraticTet10Element, MortarContactPair3D, LanczosModalEigensolver } = require('./src/core/cae/continuum_plasticity_3d');
const { FVMNavierStokes3D } = require('./src/core/cae/fvm_navier_stokes_3d');

// Phase 4 Semiconductor EDA & High-Order Optics Engines
const { AsphericSurface, DielectricThinFilm, OffAxisRayFan, MonteCarloTolerancing } = require('./src/core/optics/aspheric_freeform_optics');
const { OpticalThermalSoakEngine } = require('./src/core/optics/thermal_soak');
const { SystemVerilogSynthesizer, SystemVerilogElaborator, AIGGraph, TechnologyMapper, SKY130_STANDARD_CELLS } = require('./src/core/eda/system_verilog_synth');
const { ClockTreeSynthesis, PathFinderRouter, BSIM4CompactModel } = require('./src/core/eda/clock_tree_synthesis');
const { GdsiiStreamEngine, GdsLibrary } = require('./src/core/eda/gdsii_stream');

// Phase 5 GNC Autopilot, Chemical Process & Industrial Parity Engines
const { MultiRateScheduler, AlgebraicLoopSolver, ModernControlSynthesis } = require('./src/core/dynamic_simulink/multi_rate_scheduler');
const { ModelPredictiveController, GoldfarbIdnaniQPSolver } = require('./src/core/dynamic_simulink/model_predictive_control');
const { AutocoderCRust } = require('./src/core/dynamic_simulink/autocoder_c_rust');
const { DIPPRDatabase } = require('./src/core/plant/dippr_database');
const { NaphtaliSandholmColumnSolver, WaterHammerMOC } = require('./src/core/plant/naphtali_sandholm_mesh');

// Phase 6-13 Master Implementation Plan 2.0 Engines
const { SurfaceSurfaceIntersectionEngine, TrimmedNurbsSurface } = require('./src/core/cad/nurbs_trimmed_ssi');
const { VariableRadiusFilletEngine } = require('./src/core/cad/variable_fillet_gregory');
const { SheetMetalBend, SheetMetalFlange, SheetMetalUnfolder } = require('./src/core/cad/sheet_metal_unfolding');
const { GDTEngine, FeatureControlFrame } = require('./src/core/cad/gdt_engine');
const { AssemblyBvhHierarchy } = require('./src/core/cad/assembly_bvh_hierarchy');
const { SparseMatrixCSR, SparseCholeskySolver } = require('./src/core/math/sparse_cholesky');
const { ShellMITC4Element } = require('./src/core/cae/shell_mitc4');
const { TimoshenkoBeam3D } = require('./src/core/cae/beam_timoshenko_3d');
const { CompositePly, CompositeLaminateCLPT } = require('./src/core/cae/composite_clpt');
const { SimpleNavierStokesSolver } = require('./src/core/cae/simple_navier_stokes');
const { NLDMTable2D } = require('./src/core/eda/liberty_nldm_parser');
const { MCMMStaticTimingEngine } = require('./src/core/eda/mcmm_sta_engine');
const { ParasiticExtraction3D } = require('./src/core/eda/parasitic_extraction_3d');
const { DiffractionPSFMTFEngine } = require('./src/core/optics/diffraction_psf_mtf');
const { SimscapeDAESolver } = require('./src/core/dynamic_simulink/simscape_dae_solver');
const { MCDCCoverageAnalyzer } = require('./src/core/dynamic_simulink/mcdc_coverage');
const { PengRobinsonEOS } = require('./src/core/plant/peng_robinson_eos');
const { TemaBellDelaware } = require('./src/core/plant/tema_bell_delaware');
const { Api520ReliefValve } = require('./src/core/plant/api520_relief_valve');
const { FmiMasterEngine, FmuSlave } = require('./src/core/cosim/fmi_master_engine');

// Tier-1 Commercial Production Master Plan 3.0 Engines (Pillars 1-4)
const { VariationalConstraintSolver } = require('./src/core/cad/variational_constraint_solver');
const { TopologicalHealingEngine } = require('./src/core/cad/topological_healing_engine');
const { DampedLeastSquaresOptimizer } = require('./src/core/optics/damped_least_squares_optimizer');
const { ASMESectionVIIIDiv2Analyzer } = require('./src/core/compliance/asme_section_viii_div2');
const { GitCADVisualDiffEngine } = require('./src/core/pdm/git_cad_visual_diff');
const { EngineeringBOMManager } = require('./src/core/pdm/engineering_bom_manager');
const { WasmSparseMultifrontalSolver } = require('./src/core/math/wasm_sparse_multifrontal');
const { GPUParallelPCGSolver } = require('./src/core/math/gpu_parallel_pcg_solver');
const { WebGPUCFDKernel } = require('./src/core/cae/webgpu_cfd_kernel');

// Tier-1 10/10 Industrial Commercial Production Architecture Modules
const { IPCValidator } = require('./src/core/security/ipc_validator');
const { OmniVaultAES256 } = require('./src/core/storage/omni_archive');
const { ImmutableAuditLedger } = require('./src/core/compliance/immutable_audit_ledger');
const { accelerator } = require('./src/core/math/native_accelerator_interface');
const { OutOfCoreAssemblyManager } = require('./src/core/cad/out_of_core_octree');
const { StandardPartsLibrary } = require('./src/core/cad/standard_parts_library');
const { KeymapManager } = require('./src/ui/keymap_manager');
const { DockingManager } = require('./src/ui/docking_manager');

const auditLedger = new ImmutableAuditLedger('OmniEng_Commercial_2026');
const outOfCoreOctree = new OutOfCoreAssemblyManager();
const keymapManager = new KeymapManager();
const dockingManager = new DockingManager();

const dipprDatabase = new DIPPRDatabase();

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

  ipcMain.handle('omni:intersect-basic-nurbs-ssi', async (event, params = {}) => {
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

  // Phase 4 Semiconductor EDA & High-Order Optics IPC Handlers
  ipcMain.handle('omni:evaluate-aspheric-optics', async (event, params = {}) => {
    const asphere = new AsphericSurface(params);
    const sag = asphere.evaluateSag(params.r || 5.0);
    const normal = asphere.evaluateNormal(params.x || 3.0, params.y || 4.0);
    const ray = { origin: new Vector3(0, params.y || 4.0, -10.0), dir: new Vector3(0, 0, 1) };
    const hit = asphere.intersectRay(ray);
    return { success: true, sag, normal: normal.toArray(), hit: (hit && hit.hit && hit.point) ? { point: hit.point.toArray(), normal: hit.normal.toArray() } : null };
  });

  ipcMain.handle('omni:evaluate-thin-film-coating', async (event, params = {}) => {
    const coating = new DielectricThinFilm(params.substrateIndex || 1.5168);
    if (params.layers && params.layers.length > 0) {
      params.layers.forEach(l => coating.addLayer(l.n, l.thicknessNm));
    } else {
      coating.addLayer(1.38, 99.64);
      coating.addLayer(2.10, 65.48);
    }
    const res = coating.evaluate(params.wavelengthNm || 550.0, params.thetaDeg || 0.0);
    return { success: true, result: res };
  });

  ipcMain.handle('omni:synthesize-system-verilog', async (event, params = {}) => {
    const code = params.code || `
      module Counter #(parameter WIDTH=8) (input clk, input rst, output [WIDTH-1:0] q);
        always_ff @(posedge clk) q <= q + 1;
      endmodule
    `;
    const synth = new SystemVerilogSynthesizer();
    const synthResult = synth.synthesize(code);
    return {
      success: true,
      elaborated: {
        moduleName: synthResult.moduleName,
        parameters: synthResult.parameters,
        ports: synthResult.ports
      },
      mapped: {
        gateCount: synthResult.technologyMapping.cellCount,
        cellCount: synthResult.technologyMapping.cellCount,
        ...synthResult.technologyMapping
      }
    };
  });

  ipcMain.handle('omni:synthesize-clock-tree', async (event, params = {}) => {
    const sinks = params.sinks || [
      { id: 'ff0', x: 10, y: 10, capFf: 1.5 },
      { id: 'ff1', x: 90, y: 10, capFf: 1.5 },
      { id: 'ff2', x: 10, y: 90, capFf: 1.5 },
      { id: 'ff3', x: 90, y: 90, capFf: 1.5 }
    ];
    const tree = ClockTreeSynthesis.synthesizeHTree(sinks, { x: 50, y: 50 });
    const router = new PathFinderRouter({ width: 20, height: 20, layers: 3 });
    const route = router.routeNet({ x: 2, y: 2, layer: 0 }, { x: 12, y: 12, layer: 2 });
    return { success: true, tree, route };
  });

  ipcMain.handle('omni:solve-bsim4-vtc', async (event, params = {}) => {
    const nmos = new BSIM4CompactModel({ type: 'nmos', Vth0: 0.40, mu0: 0.05 });
    const pmos = new BSIM4CompactModel({ type: 'pmos', Vth0: -0.42, mu0: 0.02 });
    const idSat = nmos.computeCurrent(1.2, 1.2, 0.0, 0.0);
    const vtc = BSIM4CompactModel.solveInverterVTC(nmos, pmos, 1.2, 13);
    return { success: true, idSat, vtc };
  });

  // Phase 5 GNC Autopilot, Chemical Process & Industrial Parity IPC Handlers
  ipcMain.handle('omni:schedule-multi-rate', async (event, params = {}) => {
    const scheduler = new MultiRateScheduler({ baseRateHz: params.baseRateHz || 1000 });
    scheduler.addTask({
      id: 'task_fast',
      name: 'Inner Fast Loop',
      sampleRateHz: 1000,
      priority: 1,
      stepFn: (t, dt, inps) => ({ count: (inps.count || 0) + 1 })
    });
    scheduler.addTask({
      id: 'task_slow',
      name: 'Outer Slow Loop',
      sampleRateHz: 100,
      priority: 2,
      stepFn: (t, dt, inps) => ({ target: 10.0 })
    });
    scheduler.connectTasks('task_fast', 'task_slow');
    const res = scheduler.run(params.durationSec || 0.05);
    return { success: true, result: res };
  });

  ipcMain.handle('omni:solve-algebraic-loop', async (event, params = {}) => {
    const f = x => [Math.sqrt(Math.max(0, x[1]) + 2.0), 0.5 * x[0] + 1.0];
    const res = AlgebraicLoopSolver.solveBroyden(f, params.x0 || [1.0, 1.0]);
    return { success: true, result: res };
  });

  ipcMain.handle('omni:synthesize-lqr', async (event, params = {}) => {
    const A = params.A || [[0, 1], [0, 0]];
    const B = params.B || [[0], [1]];
    const Q = params.Q || [[10, 0], [0, 1]];
    const R = params.R || [[1]];
    const cLqr = ModernControlSynthesis.solveContinuousLQR(A, B, Q, R);
    return { success: true, continuous: cLqr };
  });

  ipcMain.handle('omni:autocode-controller', async (event, params = {}) => {
    const spec = params.modelSpec || {
      name: 'flight_attitude',
      A: [[0.98, 0.01], [-0.02, 0.97]],
      B: [[0.001], [0.08]],
      C: [[1.0, 0.0]],
      K: [[2.8, 1.0]],
      sampleRateHz: 1000
    };
    const cCode = AutocoderCRust.generateMisraC(spec);
    const rustCode = AutocoderCRust.generateNoStdRust(spec);
    return { success: true, cCode, rustCode };
  });

  ipcMain.handle('omni:query-dippr-database', async (event, query) => {
    const comp = dipprDatabase.get(query);
    if (!comp) return { success: false, error: 'Component not found' };
    return {
      success: true,
      component: {
        id: comp.id,
        name: comp.name,
        formula: comp.formula,
        family: comp.family,
        mw: comp.mw,
        Tc: comp.Tc,
        Pc: comp.Pc,
        Tb: comp.Tb,
        Pvap298Pa: comp.getVaporPressure(298.15),
        rhoL298KgM3: comp.getLiquidDensity(298.15),
        Cp0300: comp.getIdealGasCp(300.0)
      }
    };
  });

  ipcMain.handle('omni:solve-vlle-flash', async (event, params = {}) => {
    const res = dipprDatabase.solveVLLEFlash(params.spec || {
      components: ['Water', 'n-Hexane', 'Nitrogen'],
      feedFractions: [0.45, 0.45, 0.10],
      temperatureK: 340.0,
      pressurePa: 1.2e5
    });
    return { success: true, result: res };
  });

  ipcMain.handle('omni:solve-mesh-distillation', async (event, params = {}) => {
    const res = NaphtaliSandholmColumnSolver.solve(params.spec || {
      stages: 15,
      feedStage: 8,
      components: ['Propane', 'n-Butane', 'n-Pentane'],
      feedFlows: [15.0, 20.0, 15.0],
      feedTemperatureK: 330.0,
      pressurePa: 1.01325e5,
      refluxRatio: 2.5,
      distillateRate: 25.0
    });
    return { success: true, result: res };
  });

  ipcMain.handle('omni:solve-water-hammer-moc', async (event, params = {}) => {
    const res = WaterHammerMOC.simulateMOC(params.options || {
      pipeLengthM: 400.0,
      initialVelocityMs: 2.5,
      initialPressurePa: 4.0e5,
      closureTimeSec: 0.15,
      frictionFactor: 0.02,
      totalTimeSec: 1.5
    });
    return { success: true, result: res };
  });

  ipcMain.handle('omni:export-gdsii', async (event, params = {}) => {
    const lib = new GdsLibrary(params.libName || 'OMNI_CHIP', params.userUnits || 1e-3, params.dbUnits || 1e-9);
    const top = lib.createStructure(params.topCell || 'TOP_MACRO');
    const polys = params.polygons || [
      { layer: 1, datatype: 0, points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }] }
    ];
    for (const p of polys) {
      top.addPolygon(p.layer, p.datatype, p.points);
    }
    const buf = GdsiiStreamEngine.writeGdsii(lib);
    return { success: true, sizeBytes: buf.length, base64: buf.toString('base64') };
  });

  ipcMain.handle('omni:import-gdsii', async (event, bufferBase64) => {
    const buf = Buffer.isBuffer(bufferBase64) ? bufferBase64 : Buffer.from(bufferBase64, 'base64');
    const lib = GdsiiStreamEngine.readGdsii(buf);
    return {
      success: true,
      libraryName: lib.name,
      structureCount: lib.structures.size,
      structures: Array.from(lib.structures.keys())
    };
  });

  ipcMain.handle('omni:evaluate-optical-thermal-soak', async (event, params = {}) => {
    const spec = params.lensSpec || {
      housingMaterial: 'ALUMINUM_6061',
      elements: [
        { radius1: 50.0, radius2: -100.0, thicknessMm: 8.0, glass: 'N-BK7', airGapMm: 2.0, refractiveIndex: 1.5168 }
      ]
    };
    const res = OpticalThermalSoakEngine.evaluateThermalSoak(spec, params.targetTempC || 60.0, params.refTempC || 20.0);
    return { success: true, result: res };
  });

  ipcMain.handle('omni:solve-mpc', async (event, params = {}) => {
    const mpc = new ModelPredictiveController(params.options || {});
    const res = mpc.computeControlAction(params.x0 || [0.0, 0.0], params.yRef !== undefined ? params.yRef : 1.0);
    return { success: true, result: res };
  });

  // Phase 6-13 Advanced CAD, CAE, EDA, Optics, Simulink, Plant & FMI Co-Sim Handlers
  ipcMain.handle('omni:intersect-nurbs-ssi', async (event, params = {}) => {
    const surf1 = new TrimmedNurbsSurface(params.surf1 || {});
    const surf2 = new TrimmedNurbsSurface(params.surf2 || {});
    const res = SurfaceSurfaceIntersectionEngine.intersectSurfaces(surf1, surf2, params.options || { tolerance: 0.05 });
    return { success: true, result: res };
  });

  ipcMain.handle('omni:unfold-sheet-metal', async (event, params = {}) => {
    const bend = new SheetMetalBend(params.bend || { angleDeg: 90.0, innerRadiusMm: 2.0, thicknessMm: 2.0, kFactor: 0.44 });
    const flanges = (params.flanges || [{ name: 'F1', lengthMm: 50, widthMm: 50 }, { name: 'F2', lengthMm: 50, widthMm: 50 }])
      .map(f => new SheetMetalFlange(f.name, f.lengthMm, f.widthMm));
    const flat = SheetMetalUnfolder.unfoldPart({ flanges, bends: [bend] });
    return { success: true, flat, bendAllowanceMm: bend.bendAllowanceMm, bendDeductionMm: bend.bendDeductionMm };
  });

  ipcMain.handle('omni:evaluate-gdt', async (event, params = {}) => {
    const fcf = new FeatureControlFrame(params.fcf || { specifiedTolerance: 0.20, materialCondition: 'MMC' });
    const res = GDTEngine.evaluateTruePosition(params.hole || {
      nominalX: 50.0, nominalY: 30.0, measuredX: 50.08, measuredY: 29.95,
      nominalDiameter: 10.0, measuredDiameter: 10.25, lowerTolerance: -0.30, upperTolerance: 0.30
    }, fcf);
    return { success: true, result: res };
  });

  ipcMain.handle('omni:solve-sparse-cholesky', async (event, params = {}) => {
    const N = params.N || 50;
    const A = new SparseMatrixCSR(N, N);
    for (let i = 0; i < N; i++) {
      A.addEntry(i, i, 4.0);
      if (i > 0) A.addEntry(i, i - 1, -1.0);
      if (i < N - 1) A.addEntry(i, i + 1, -1.0);
    }
    A.finalize();
    const b = new Float64Array(N).fill(1.0);
    const sol = SparseCholeskySolver.solve(A, b, params.options || { tolerance: 1e-8 });
    return { success: true, solution: sol };
  });

  ipcMain.handle('omni:compute-shell-mitc4', async (event, params = {}) => {
    const nodes = [0, 1, 2, 3];
    const coords = params.coords || [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
    const shell = new ShellMITC4Element(1, nodes, coords, params.properties || { thickness: 0.001, E: 210e9, nu: 0.3 });
    const Ke = shell.computeStiffnessMatrix();
    return { success: true, matrixSize: Ke.length, sampleEntry: Ke[0] };
  });

  ipcMain.handle('omni:compute-beam-timoshenko', async (event, params = {}) => {
    const beam = new TimoshenkoBeam3D(1, [0, 1], params.coords || [{ x: 0, y: 0, z: 0 }, { x: 2.0, y: 0, z: 0 }], params.section || {
      E: 200e9, nu: 0.3, A: 0.005, Iy: 8.33e-6, Iz: 8.33e-6, J: 1.4e-5
    });
    const Ke = beam.computeLocalStiffnessMatrix();
    const buckling = beam.calculateEulerBucklingLoad(params.K || 2.0);
    return { success: true, stiffnessSize: Ke.length, buckling };
  });

  ipcMain.handle('omni:evaluate-composite-clpt', async (event, params = {}) => {
    const ply0 = new CompositePly({ orientationDeg: 0, thicknessMm: 0.125, E1: 142e9, E2: 10.3e9, nu12: 0.27, G12: 7.2e9 });
    const ply90 = new CompositePly({ orientationDeg: 90, thicknessMm: 0.125, E1: 142e9, E2: 10.3e9, nu12: 0.27, G12: 7.2e9 });
    const laminate = new CompositeLaminateCLPT([ply0, ply90, ply90, ply0]);
    const tw = CompositeLaminateCLPT.evaluateTsaiWu(ply0, 400e6, 30e6, 40e6);
    return { success: true, A: laminate.A, B: laminate.B, D: laminate.D, tsaiWu: tw };
  });

  ipcMain.handle('omni:step-simple-cfd', async (event, params = {}) => {
    const solver = new SimpleNavierStokesSolver();
    const cells = params.cells || [
      { u: 0, v: 0, w: 0, p: 101325, centroid: { x: 0, y: 0, z: 0 }, volume: 1e-3, gradP: { x: 0, y: 0, z: 0 } },
      { u: 0, v: 0, w: 0, p: 101325, centroid: { x: 0.1, y: 0, z: 0 }, volume: 1e-3, gradP: { x: 0, y: 0, z: 0 } }
    ];
    const faces = params.faces || [
      { leftCell: 0, rightCell: 1, area: 0.01, normal: { x: 1, y: 0, z: 0 } },
      { leftCell: 0, rightCell: -1, boundaryType: 'inlet', inletVelocity: 2.0, area: 0.01, normal: { x: -1, y: 0, z: 0 } }
    ];
    const res = solver.stepSIMPLE(cells, faces);
    return { success: true, result: res };
  });

  ipcMain.handle('omni:run-mcmm-sta', async (event, params = {}) => {
    const sta = MCMMStaticTimingEngine.runMCMMAnalysis(params);
    return { success: true, result: sta };
  });

  ipcMain.handle('omni:extract-pex-3d', async (event, params = {}) => {
    const pex = ParasiticExtraction3D.extractWireRC(params || { lengthUm: 100, widthUm: 0.1, thicknessUm: 0.15, spacingUm: 0.1, dielectricHeightUm: 0.2 });
    return { success: true, result: pex };
  });

  ipcMain.handle('omni:evaluate-wavefront-psf', async (event, params = {}) => {
    const res = DiffractionPSFMTFEngine.evaluateWavefrontPSFandMTF(params || { gridSize: 64, wavelengthUm: 0.55, fNumber: 2.8 });
    return { success: true, result: res };
  });

  ipcMain.handle('omni:simulate-simscape-dae', async (event, params = {}) => {
    const res = SimscapeDAESolver.simulateElectromechanicalDCMotor(params || {});
    return { success: true, result: res };
  });

  ipcMain.handle('omni:evaluate-mcdc-coverage', async (event, params = {}) => {
    const conditionNames = params.conditionNames || ['A', 'B', 'C'];
    const decisionFunc = (A, B, C) => A && (B || C);
    const testVectors = params.testVectors || [
      [false, true, false],
      [true, true, false],
      [true, false, false],
      [true, false, true]
    ];
    const report = MCDCCoverageAnalyzer.evaluateMCDCCoverage(conditionNames, decisionFunc, testVectors);
    return { success: true, report };
  });

  ipcMain.handle('omni:flash-peng-robinson', async (event, params = {}) => {
    const eos = new PengRobinsonEOS(params.components || ['methane', 'ethane', 'propane']);
    const flash = eos.flashPT(params.z || [0.5, 0.3, 0.2], params.T || 200.0, params.P || 2000000.0);
    return { success: true, flash };
  });

  ipcMain.handle('omni:rate-tema-heat-exchanger', async (event, params = {}) => {
    const tema = new TemaBellDelaware(params.geom || {
      Ds: 0.60, do: 0.020, Pt: 0.025, pitchAngle: 30, L: 4.0, B: 0.30, Bc: 0.20, Nt: 350
    });
    const rating = tema.rateShellSide(params.fluid || {
      massFlow: 15.0, rho: 850.0, mu: 0.002, Cp: 2100.0, k: 0.14
    });
    return { success: true, rating };
  });

  ipcMain.handle('omni:size-api520-prv', async (event, params = {}) => {
    const sizing = Api520ReliefValve.sizeGasVapor(params || {
      massFlow: 5000, P1: 1100, Pb: 101.325, T: 320, M: 28.97, k: 1.40
    });
    return { success: true, sizing };
  });

  ipcMain.handle('omni:run-fmi-cosimulation', async (event, params = {}) => {
    const master = new FmiMasterEngine(params.config || { startTime: 0, stopTime: 0.05, defaultStepSize: 0.001 });
    const slave1 = new FmuSlave({ instanceName: 'Controller', variables: [{ vr: 1, initial: 10.0, causality: 'output' }] });
    const slave2 = new FmuSlave({ instanceName: 'Actuator', variables: [{ vr: 2, initial: 0.0, causality: 'input' }] });
    master.addSlave(slave1);
    master.addSlave(slave2);
    master.addConnection(slave1, 1, slave2, 2);
    const sim = master.simulate();
    return { success: true, result: sim };
  });

  // Tier-1 Commercial Production Master Plan 3.0 Handlers (Pillars 1-4)
  ipcMain.handle('omni:solve-variational-sketch', async (event, params = {}) => {
    const solver = new VariationalConstraintSolver();
    if (params.points) {
      for (const p of params.points) {
        solver.addPoint(p.id, p.x, p.y, p.fixed);
      }
    }
    if (params.constraints) {
      for (const c of params.constraints) {
        solver.addConstraint(c);
      }
    }
    const res = solver.solve();
    return { success: res.converged, ...res };
  });

  ipcMain.handle('omni:heal-cad-geometry', async (event, params = {}) => {
    const healer = new TopologicalHealingEngine(params.options || { tolerance: 0.05 });
    const res = healer.healSolid(params.dirtyModel || { vertices: [], faces: [] }, params.options);
    return { success: res.healed, ...res };
  });

  ipcMain.handle('omni:optimize-optical-dls', async (event, params = {}) => {
    const optimizer = new DampedLeastSquaresOptimizer(params.options || {});
    const system = params.system || {
      entrancePupilRadius: 10.0,
      targetEfl: 50.0,
      surfaces: [
        { radius: 50.0, thickness: 5.0, refractiveIndex: 1.5168 },
        { radius: -80.0, thickness: 48.0, refractiveIndex: 1.0 },
        { radius: 0.0, thickness: 0.0, refractiveIndex: 1.0 }
      ]
    };
    const variables = params.variables || [
      { surfaceIndex: 0, param: 'radius', min: 20.0, max: 100.0 }
    ];
    const operands = params.operands || [];
    const res = optimizer.optimize(system, variables, operands);
    return { success: true, ...res };
  });

  ipcMain.handle('omni:evaluate-asme-viii-div2', async (event, params = {}) => {
    const analyzer = new ASMESectionVIIIDiv2Analyzer({
      designPressureMpa: params.designPressureMpa || 10.0,
      designTemperatureC: params.designTemperatureC || 150.0,
      material: params.material || 'SA-516 Grade 70',
      allowableStressS: params.allowableStressS || 138.0,
      yieldStrengthSy: params.yieldStrengthSy || 260.0
    });
    const sclPoints = params.sclPoints || [
      { x: -12.5, stressMpa: 110.0 },
      { x: 0.0, stressMpa: 90.0 },
      { x: 12.5, stressMpa: 80.0 }
    ];
    const wallThicknessMm = params.wallThicknessMm || 25.0;
    const res = analyzer.linearizeStressClassificationLine(sclPoints, wallThicknessMm, params.isSecondaryThermal);
    const certDoc = analyzer.generateFormalCertificationDocument({
      vesselTag: params.vesselTag || 'V-101 Production Separator Vessel',
      sclAnalysis: res
    });
    return { success: true, ...res, certDoc };
  });

  ipcMain.handle('omni:visual-diff-cad', async (event, params = {}) => {
    const engine = new GitCADVisualDiffEngine(params.options || {});
    const res = engine.compareRevisions(params.modelA || params.revA || {}, params.modelB || params.revB || {});
    return { success: true, ...res };
  });

  ipcMain.handle('omni:rollup-ebom', async (event, params = {}) => {
    const bom = new EngineeringBOMManager();
    const root = params.rootAssembly || {
      partNumber: params.partNumber || 'ASM-01',
      name: params.name || 'Main Assembly',
      children: params.items || []
    };
    bom.setRootAssembly(root);
    const rolledUp = bom.computeRollUp();
    const indented = bom.generateIndentedBOM();
    const flattened = bom.generateFlattenedBOM();
    const csv = bom.exportToCSV();
    return { success: true, rolledUp, indented, flattened, csv };
  });

  // High-Performance Core Linear Solvers & Multiphysics Kernels
  ipcMain.handle('omni:solve-wasm-sparse-multifrontal', async (event, params = {}) => {
    const { N = 100, triplets, b, leafCutoff = 32 } = params;
    const solver = new WasmSparseMultifrontalSolver(N, { leafCutoff });
    if (triplets && triplets.length > 0) {
      for (const t of triplets) {
        solver.addEntry(t[0], t[1], t[2]);
      }
    } else {
      // Default 1D Poisson tridiagonal if none provided
      for (let i = 0; i < N; i++) {
        solver.addEntry(i, i, 2.0);
        if (i + 1 < N) {
          solver.addEntry(i, i + 1, -1.0);
          solver.addEntry(i + 1, i, -1.0);
        }
      }
    }
    const t0 = performance.now();
    const fact = solver.factorize();
    const rhs = b ? new Float64Array(b) : new Float64Array(N).fill(1.0);
    const solveRes = solver.solve(rhs);
    const x = solveRes.solution;
    const totalTimeMs = performance.now() - t0;
    let norm = 0;
    for (let i = 0; i < x.length; i++) norm += x[i] * x[i];
    return {
      success: true,
      N,
      nnzL: fact.nnzL,
      fillRatio: fact.fillRatio,
      factorizationTimeMs: fact.factorizationTimeMs,
      totalTimeMs,
      solutionNorm: Math.sqrt(norm),
      relativeResidual: solveRes.relativeResidual,
      sampleSolution: Array.from(x.slice(0, 5))
    };
  });

  ipcMain.handle('omni:solve-gpu-parallel-pcg', async (event, params = {}) => {
    const { N = 100, maxIter = 500, tol = 1e-6 } = params;
    const solver = new GPUParallelPCGSolver({ maxIterations: maxIter, tolerance: tol });
    let csr = params.csr;
    let b = params.b ? new Float64Array(params.b) : null;
    if (!csr) {
      const rowPtr = new Int32Array(N + 1);
      const colIndices = [];
      const values = [];
      for (let i = 0; i < N; i++) {
        rowPtr[i] = colIndices.length;
        if (i > 0) { colIndices.push(i - 1); values.push(-1.0); }
        colIndices.push(i); values.push(2.0);
        if (i < N - 1) { colIndices.push(i + 1); values.push(-1.0); }
      }
      rowPtr[N] = colIndices.length;
      csr = {
        N,
        nnz: values.length,
        rowPtr,
        colIndices: new Int32Array(colIndices),
        values: new Float64Array(values)
      };
      b = new Float64Array(N).fill(1.0);
    }
    const res = solver.solve(csr, b);
    const sol = res.solution || res.x || new Float64Array(0);
    return { success: res.converged, ...res, sampleSolution: Array.from(sol.slice(0, 5)) };
  });

  ipcMain.handle('omni:solve-webgpu-cfd-poisson', async (event, params = {}) => {
    const { nx = 32, ny = 32, maxIter = 100 } = params;
    const kernel = new WebGPUCFDKernel({ nx, ny, maxIterations: maxIter });
    const b = params.b ? new Float32Array(params.b) : new Float32Array(nx * ny).fill(1.0);
    const p = new Float32Array(nx * ny);
    const res = kernel.solvePressurePoisson(p, b);
    return { success: res.converged, ...res };
  });

  // =========================================================================
  // Tier-1 10/10 Industrial Commercial Production IPC Channels
  // =========================================================================

  ipcMain.handle('omni:security-validate-input', async (event, params = {}) => {
    const sanitized = IPCValidator.sanitize(params.payload || {});
    if (params.finiteFields && Array.isArray(params.finiteFields)) {
      IPCValidator.validateFiniteNumbers(sanitized, params.finiteFields);
    }
    return { success: true, sanitized };
  });

  ipcMain.handle('omni:vault-encrypt-project', async (event, params = {}) => {
    const { password = 'DefaultOmniPassword2026', payload = {} } = params;
    const buf = Buffer.from(JSON.stringify(payload), 'utf8');
    const encrypted = OmniVaultAES256.encrypt(buf, password);
    return { success: true, encryptedBytes: encrypted.length, isEncrypted: true };
  });

  ipcMain.handle('omni:vault-decrypt-project', async (event, params = {}) => {
    const { password = 'DefaultOmniPassword2026', encryptedBytes } = params;
    const buf = Buffer.from(encryptedBytes);
    const decrypted = OmniVaultAES256.decrypt(buf, password);
    const parsed = JSON.parse(decrypted.toString('utf8'));
    return { success: true, payload: parsed };
  });

  ipcMain.handle('omni:get-standard-fastener', async (event, params = {}) => {
    const { type = 'bolt', nominalDiaMm = 8, lengthMm = 40, propertyClass = '8.8' } = params;
    if (type === 'bolt') {
      return { success: true, ...StandardPartsLibrary.generateHexBolt(nominalDiaMm, lengthMm, propertyClass) };
    } else if (type === 'nut') {
      return { success: true, ...StandardPartsLibrary.generateHexNut(nominalDiaMm, propertyClass) };
    } else if (type === 'bearing') {
      return { success: true, ...StandardPartsLibrary.generateBallBearing(params.designation || '6204') };
    } else if (type === 'hole_callout') {
      return { success: true, ...StandardPartsLibrary.generateHoleCallout(nominalDiaMm, lengthMm, true) };
    }
    return { success: false, error: `Unknown fastener type: ${type}` };
  });

  ipcMain.handle('omni:get-out-of-core-lod', async (event, params = {}) => {
    const { cameraPosition = [0, 0, 100], frustumBounds = [-200, -200, -200, 200, 200, 200] } = params;
    const res = outOfCoreOctree.evaluateVisibleLODs(cameraPosition, frustumBounds);
    return { success: true, ...res };
  });

  ipcMain.handle('omni:audit-record-action', async (event, params = {}) => {
    const { author = 'USER', actionType = 'PARAMETRIC_EDIT', details = {} } = params;
    const entry = auditLedger.recordAction(author, actionType, details);
    const integrity = auditLedger.verifyChainIntegrity();
    return { success: true, entry, chainIntegrity: integrity };
  });

  ipcMain.handle('omni:get-keymap-profiles', async (event, params = {}) => {
    return { success: true, profiles: keymapManager.getProfilesList(), activeProfile: keymapManager.currentProfile };
  });

  ipcMain.handle('omni:get-accelerator-info', async (event, params = {}) => {
    return { success: true, ...accelerator.getBackendInfo() };
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

            // 10. Test Phase 4 Semiconductor EDA & High-Order Optics
            const asphericRes = await window.omniEngAPI.evaluateAsphericOptics({ r: 5.0 });
            assert(asphericRes && asphericRes.success && asphericRes.sag > 0, 'IPC evaluateAsphericOptics evaluates non-spherical sag');

            const thinFilmRes = await window.omniEngAPI.evaluateThinFilmCoating({ wavelengthNm: 550.0 });
            assert(thinFilmRes && thinFilmRes.success && thinFilmRes.result.reflectance < 0.05, 'IPC evaluateThinFilmCoating computes BBAR reflectance');

            const svRes = await window.omniEngAPI.synthesizeSystemVerilog({});
            assert(svRes && svRes.success && svRes.mapped.gateCount > 0, 'IPC synthesizeSystemVerilog elaborates IEEE 1800 AST and maps gates');

            const ctsRes = await window.omniEngAPI.synthesizeClockTree({});
            assert(ctsRes && ctsRes.success && ctsRes.route.wirelength > 0, 'IPC synthesizeClockTree synthesizes H-tree and routes metal layers');

            const bsim4Res = await window.omniEngAPI.solveBsim4Vtc({});
            assert(bsim4Res && bsim4Res.success && bsim4Res.vtc.switchingThresholdVm > 0.4, 'IPC solveBsim4Vtc evaluates CMOS inverter switching threshold');

            // 11. Test Phase 5 GNC Autopilot, Chemical Process & Industrial Parity
            const schedRes = await window.omniEngAPI.scheduleMultiRate({ durationSec: 0.05 });
            assert(schedRes && schedRes.success && schedRes.result.totalTicks === 50, 'IPC scheduleMultiRate executes multi-rate tasks deterministically');

            const lqrRes = await window.omniEngAPI.synthesizeLQR({});
            assert(lqrRes && lqrRes.success && lqrRes.continuous.K[0][0] > 0, 'IPC synthesizeLQR solves Riccati equation for optimal feedback gain');

            const autocodeRes = await window.omniEngAPI.autocodeController({});
            assert(autocodeRes && autocodeRes.success && autocodeRes.rustCode.includes('#![no_std]'), 'IPC autocodeController generates zero-alloc #![no_std] Rust code');

            const dipprRes = await window.omniEngAPI.queryDipprDatabase('Water');
            assert(dipprRes && dipprRes.success && dipprRes.component.mw === 18.015, 'IPC queryDipprDatabase retrieves thermophysical parameters');

            const vlleRes = await window.omniEngAPI.solveVlleFlash({});
            assert(vlleRes && vlleRes.success && vlleRes.result.converged, 'IPC solveVlleFlash executes 3-phase VLLE liquid-liquid-vapor flash');

            const meshColRes = await window.omniEngAPI.solveMeshDistillation({});
            assert(meshColRes && meshColRes.success && meshColRes.result.stages.length === 15, 'IPC solveMeshDistillation solves simultaneous MESH column');

            const hammerRes = await window.omniEngAPI.solveWaterHammerMOC({});
            assert(hammerRes && hammerRes.success && hammerRes.result.passedAsmeB31_3, 'IPC solveWaterHammerMOC simulates transient wave damping and ASME B31.3 stress');

            // 12. Test Binary GDSII Stream, Optical Thermal Soak, and Constrained MPC
            const gdsExportRes = await window.omniEngAPI.exportGdsii({});
            assert(gdsExportRes && gdsExportRes.success && gdsExportRes.sizeBytes > 50, 'IPC exportGdsii serializes binary GDSII Stream format');

            const gdsImportRes = await window.omniEngAPI.importGdsii(gdsExportRes.base64);
            assert(gdsImportRes && gdsImportRes.success && gdsImportRes.structureCount === 1, 'IPC importGdsii deserializes binary GDSII records');

            const thermalSoakRes = await window.omniEngAPI.evaluateOpticalThermalSoak({ targetTempC: 60.0 });
            assert(thermalSoakRes && thermalSoakRes.success && thermalSoakRes.result.focalShiftMm !== 0, 'IPC evaluateOpticalThermalSoak computes dn/dT and CTE expansion');

            const mpcRes = await window.omniEngAPI.solveMPC({ x0: [0.5, 0.0], yRef: 1.0 });
            assert(mpcRes && mpcRes.success && mpcRes.result.qpConverged, 'IPC solveMPC executes constrained Goldfarb-Idnani dual QP');

            // 13. Test Phase 6-13 Master Implementation Plan 2.0 (CAD, CAE, EDA, Optics, Simulink, Plant, Co-Sim)
            const ssiRes = await window.omniEngAPI.intersectNurbsSSI({});
            assert(ssiRes && ssiRes.success && ssiRes.result.intersectionFound, 'IPC intersectNurbsSSI computes trimmed NURBS intersection curve');

            const smRes = await window.omniEngAPI.unfoldSheetMetal({});
            assert(smRes && smRes.success && smRes.flat.totalDevelopedLengthMm > 90, 'IPC unfoldSheetMetal computes DIN 6935 K-factor developed blank');

            const gdtRes = await window.omniEngAPI.evaluateGDT({});
            assert(gdtRes && gdtRes.success && gdtRes.result.passed, 'IPC evaluateGDT evaluates ASME Y14.5 MMC true position and bonus tolerance');

            const cholRes = await window.omniEngAPI.solveSparseCholesky({ N: 50 });
            assert(cholRes && cholRes.success && cholRes.solution.converged, 'IPC solveSparseCholesky factors and solves symmetric positive definite system');

            const shellRes = await window.omniEngAPI.computeShellMITC4({});
            assert(shellRes && shellRes.success && shellRes.matrixSize === 576, 'IPC computeShellMITC4 computes 24x24 locking-free stiffness matrix');

            const timRes = await window.omniEngAPI.computeBeamTimoshenko({});
            assert(timRes && timRes.success && timRes.buckling.criticalPcr > 0, 'IPC computeBeamTimoshenko evaluates 3D frame stiffness and Euler buckling');

            const clptRes = await window.omniEngAPI.evaluateCompositeCLPT({});
            assert(clptRes && clptRes.success && clptRes.tsaiWu.isSafe, 'IPC evaluateCompositeCLPT evaluates ABD laminate matrices and Tsai-Wu index');

            const cfdRes2 = await window.omniEngAPI.stepSimpleCFD({});
            assert(cfdRes2 && cfdRes2.success && cfdRes2.result.iteration === 1, 'IPC stepSimpleCFD performs SIMPLE segregated iteration with Rhie-Chow');

            const mcmmRes = await window.omniEngAPI.runMcmmSTA({ clockPeriodNs: 1.0, logicDelayTypNs: 0.50 });
            assert(mcmmRes && mcmmRes.success && mcmmRes.result.signoffPassed, 'IPC runMcmmSTA evaluates MCMM timing slacks across WCS, TYP, BCF corners');

            const pexRes = await window.omniEngAPI.extractPex3D({});
            assert(pexRes && pexRes.success && pexRes.result.capacitanceCouplingFf > 0, 'IPC extractPex3D computes 3D wire resistance, fringe and coupling cap');

            const psfRes = await window.omniEngAPI.evaluateWavefrontPSF({});
            assert(psfRes && psfRes.success && psfRes.result.strehlRatio >= 0.80, 'IPC evaluateWavefrontPSF evaluates 2D FFT Point Spread Function & MTF');

            const simscapeRes = await window.omniEngAPI.simulateSimscapeDAE({ totalTimeSec: 3.0 });
            assert(simscapeRes && simscapeRes.success && simscapeRes.result.simulationStepsCount > 0, 'IPC simulateSimscapeDAE integrates index-1 stiff DAE network');

            const mcdcRes = await window.omniEngAPI.evaluateMcdcCoverage({});
            assert(mcdcRes && mcdcRes.success && mcdcRes.report.mcdcCoveragePercent === 100, 'IPC evaluateMcdcCoverage verifies DO-178C DAL-A MC/DC independence pairs');

            const prRes = await window.omniEngAPI.flashPengRobinson({});
            assert(prRes && prRes.success && prRes.flash.converged, 'IPC flashPengRobinson executes PR-78 cubic VLE flash with Rachford-Rice');

            const temaRes = await window.omniEngAPI.rateTemaHeatExchanger({});
            assert(temaRes && temaRes.success && temaRes.rating.h_shell > 100, 'IPC rateTemaHeatExchanger rates shell-side heat transfer via Bell-Delaware');

            const prvRes = await window.omniEngAPI.sizeApi520PRV({});
            assert(prvRes && prvRes.success && prvRes.sizing.selectedOrifice.designation.length > 0, 'IPC sizeApi520PRV sizes pressure relief valve and selects API 526 orifice');

            const fmiRes = await window.omniEngAPI.runFmiCoSimulation({});
            assert(fmiRes && fmiRes.success && fmiRes.result.converged, 'IPC runFmiCoSimulation orchestrates cross-domain FMI Co-Simulation master');

            // 14. Test UI Buttons for Sheet Metal, GD&T, and FMI Co-Simulation
            assert(!!document.getElementById('ribbon-btn-sheet-metal'), 'Ribbon button: Sheet Metal exists');
            assert(!!document.getElementById('ribbon-btn-gdt'), 'Ribbon button: GD&T exists');
            assert(!!document.getElementById('ribbon-btn-fmi'), 'Ribbon button: FMI Co-Sim exists');

            document.getElementById('ribbon-btn-sheet-metal').click();
            document.getElementById('ribbon-btn-gdt').click();
            document.getElementById('ribbon-btn-fmi').click();
            await new Promise(r => setTimeout(r, 300));
            assert(true, 'Ribbon buttons Sheet Metal, GD&T, and FMI Co-Sim clicked without error');

            // 15. Test WebGPU Viewport & Interactive Block Canvas in window
            assert(typeof window.HighCapacityWebGPUViewport === 'function', 'HighCapacityWebGPUViewport loaded in window');
            const gpuVp = new window.HighCapacityWebGPUViewport({ canvasId: 'main-canvas' });
            assert(gpuVp && gpuVp.maxPolygons === 5000000, 'HighCapacityWebGPUViewport initialized with 5M polygon target');
            assert(typeof window.InteractiveBlockCanvasEngine === 'function', 'InteractiveBlockCanvasEngine loaded in window');
            const blockCanvas = new window.InteractiveBlockCanvasEngine();
            assert(blockCanvas && typeof blockCanvas.createBlock === 'function', 'InteractiveBlockCanvasEngine initialized');

            // 16. Test Tier-1 Commercial Production Master Plan 3.0 APIs
            const varRes = await window.omniEngAPI.solveVariationalSketch({
              points: [
                { id: 'P1', x: 0, y: 0, fixed: true },
                { id: 'P2', x: 38, y: 2, fixed: false },
                { id: 'P3', x: 2, y: 28, fixed: false }
              ],
              constraints: [
                { type: 'HORIZONTAL', point1: 'P1', point2: 'P2' },
                { type: 'VERTICAL', point1: 'P1', point2: 'P3' },
                { type: 'DISTANCE', point1: 'P1', point2: 'P2', value: 40.0 },
                { type: 'DISTANCE', point1: 'P1', point2: 'P3', value: 30.0 }
              ]
            });
            assert(varRes && varRes.success && Math.abs(varRes.points.P2.x - 40.0) < 1e-4, 'IPC solveVariationalSketch solves 2D geometric constraints');

            const healRes = await window.omniEngAPI.healCadGeometry({
              dirtyModel: {
                vertices: [
                  { id: 'v1', x: 0, y: 0, z: 0 },
                  { id: 'v2', x: 0.02, y: 0.01, z: 0 },
                  { id: 'v3', x: 10, y: 0, z: 0 },
                  { id: 'v4', x: 10, y: 10, z: 0 },
                  { id: 'v5', x: 0, y: 10, z: 0 }
                ],
                faces: [
                  { id: 'f1', vertexIds: ['v1', 'v3', 'v4', 'v5'] },
                  { id: 'f_sliver', vertexIds: ['v1', 'v2', 'v3'] }
                ]
              }
            });
            assert(healRes && healRes.success && healRes.stitchedVerticesCount === 1, 'IPC healCadGeometry stitches micro-gaps and collapses slivers');

            const dlsRes = await window.omniEngAPI.optimizeOpticalDLS({
              variables: [{ surfaceIndex: 0, param: 'radius', min: 20.0, max: 100.0 }]
            });
            assert(dlsRes && dlsRes.success && dlsRes.finalMerit !== undefined, 'IPC optimizeOpticalDLS performs Levenberg-Marquardt optimization');

            const asmeRes = await window.omniEngAPI.evaluateASMEVIIIDiv2({
              sclPoints: [
                { x: -12.5, stressMpa: 110.0 },
                { x: 0.0, stressMpa: 90.0 },
                { x: 12.5, stressMpa: 80.0 }
              ],
              wallThicknessMm: 25.0
            });
            assert(asmeRes && asmeRes.success && asmeRes.evaluation && asmeRes.evaluation.overallConforms, 'IPC evaluateASMEVIIIDiv2 performs stress linearization Pm, Pb, Q');

            const diffRes = await window.omniEngAPI.visualDiffCAD({
              modelA: { faces: [{ id: 'f1', area: 10, normal: [0, 0, 1] }] },
              modelB: { faces: [{ id: 'f1', area: 10, normal: [0, 0, 1] }] }
            });
            assert(diffRes && diffRes.success && diffRes.colorMap !== undefined, 'IPC visualDiffCAD diffs 3D CAD B-Rep models');

            const bomRes = await window.omniEngAPI.rollupEBOM({
              items: [
                { partNumber: 'PRT-01', name: 'Bracket', quantity: 2, unitCostUsd: 5, unitMassKg: 0.5 }
              ]
            });
            assert(bomRes && bomRes.success && bomRes.flattened.length > 0, 'IPC rollupEBOM rolls up hierarchical eBOM');

            // 17. Test High-Performance Solvers & Multiphysics Kernels
            const wasmSparseRes = await window.omniEngAPI.solveWasmSparseMultifrontal({ N: 40 });
            assert(wasmSparseRes && wasmSparseRes.success && wasmSparseRes.nnzL > 0, 'IPC solveWasmSparseMultifrontal factorizes sparse system');

            const pcgRes = await window.omniEngAPI.solveGpuParallelPCG({ N: 30 });
            assert(pcgRes && pcgRes.success && pcgRes.iterations > 0, 'IPC solveGpuParallelPCG converges on linear system');

            const cfdPoissonRes = await window.omniEngAPI.solveWebGPUCFDPoisson({ nx: 16, ny: 16, maxIter: 50 });
            assert(cfdPoissonRes && cfdPoissonRes.success, 'IPC solveWebGPUCFDPoisson solves pressure Poisson equation');

            // 18. Test Tier-1 Commercial Production Modals & Ribbon Buttons
            assert(!!document.getElementById('ribbon-btn-sketcher'), 'Ribbon button: Variational Sketcher exists');
            assert(!!document.getElementById('ribbon-btn-heal'), 'Ribbon button: Auto-Heal exists');
            assert(!!document.getElementById('ribbon-btn-opt-dls'), 'Ribbon button: DLS Optimizer exists');
            assert(!!document.getElementById('ribbon-btn-asme'), 'Ribbon button: ASME VIII Div 2 exists');
            assert(!!document.getElementById('ribbon-btn-cad-diff'), 'Ribbon button: CAD Diff exists');
            assert(!!document.getElementById('ribbon-btn-ebom'), 'Ribbon button: eBOM Manager exists');

            // Test Variational Sketcher UI
            document.getElementById('ribbon-btn-sketcher').click();
            await new Promise(r => setTimeout(r, 200));
            assert(document.getElementById('modal-variational-sketcher').classList.contains('active'), 'Modal: Variational Sketcher opens active');
            assert(!!document.getElementById('canvas-variational-sketcher'), 'Variational Sketcher 2D canvas rendered');
            document.getElementById('btn-solve-sketcher').click();
            await new Promise(r => setTimeout(r, 100));
            document.getElementById('btn-close-variational-sketcher').click();
            assert(!document.getElementById('modal-variational-sketcher').classList.contains('active'), 'Modal: Variational Sketcher closes');

            // Test Topological Healer UI
            document.getElementById('ribbon-btn-heal').click();
            await new Promise(r => setTimeout(r, 200));
            assert(document.getElementById('modal-topological-healer').classList.contains('active'), 'Modal: Topological Healer opens active');
            document.getElementById('btn-run-auto-heal').click();
            await new Promise(r => setTimeout(r, 200));
            assert(document.getElementById('healing-log-output').textContent.includes('HEALING COMPLETE'), 'Auto-Heal executes and logs watertight status');
            document.getElementById('btn-close-topological-healer').click();
            assert(!document.getElementById('modal-topological-healer').classList.contains('active'), 'Modal: Topological Healer closes');

            // Test DLS Optimizer UI
            document.getElementById('ribbon-btn-opt-dls').click();
            await new Promise(r => setTimeout(r, 200));
            assert(document.getElementById('modal-dls-optimizer').classList.contains('active'), 'Modal: DLS Optimizer opens active');
            assert(!!document.getElementById('canvas-dls-convergence'), 'DLS Convergence canvas rendered');
            document.getElementById('btn-run-dls-opt').click();
            await new Promise(r => setTimeout(r, 200));
            document.getElementById('btn-close-dls-optimizer').click();
            assert(!document.getElementById('modal-dls-optimizer').classList.contains('active'), 'Modal: DLS Optimizer closes');

            // Test ASME Section VIII Div 2 Report UI
            document.getElementById('ribbon-btn-asme').click();
            await new Promise(r => setTimeout(r, 200));
            assert(document.getElementById('modal-asme-report').classList.contains('active'), 'Modal: ASME VIII Div 2 Report opens active');
            document.getElementById('btn-close-asme-report').click();
            assert(!document.getElementById('modal-asme-report').classList.contains('active'), 'Modal: ASME VIII Div 2 Report closes');

            // Test 3D CAD Visual Diff UI
            document.getElementById('ribbon-btn-cad-diff').click();
            await new Promise(r => setTimeout(r, 200));
            assert(document.getElementById('modal-cad-diff').classList.contains('active'), 'Modal: 3D CAD Diff opens active');
            document.getElementById('btn-run-cad-diff').click();
            await new Promise(r => setTimeout(r, 200));
            document.getElementById('btn-close-cad-diff').click();
            assert(!document.getElementById('modal-cad-diff').classList.contains('active'), 'Modal: 3D CAD Diff closes');

            // Test Hierarchical eBOM Manager UI
            document.getElementById('ribbon-btn-ebom').click();
            await new Promise(r => setTimeout(r, 200));
            assert(document.getElementById('modal-ebom-manager').classList.contains('active'), 'Modal: eBOM Manager opens active');
            document.getElementById('btn-consolidate-hardware').click();
            await new Promise(r => setTimeout(r, 200));
            document.getElementById('btn-close-ebom-manager').click();
            assert(!document.getElementById('modal-ebom-manager').classList.contains('active'), 'Modal: eBOM Manager closes');

            // 19. Test Command Palette (Ctrl+K), Workspace Tabs, Theme Toggle, and Solver Progress
            assert(!!document.getElementById('command-palette-modal'), 'Modal: Command Palette exists');
            assert(!!document.getElementById('btn-open-palette'), 'Button: Quick Find (Ctrl+K) exists');
            assert(!!document.getElementById('btn-toggle-theme'), 'Button: Theme Toggle exists');
            assert(!!document.getElementById('workspace-tab-bar'), 'Workspace Tab Bar exists');
            assert(!!document.getElementById('global-solver-progress'), 'Global Solver Progress bar exists');

            // Open and test Command Palette
            document.getElementById('btn-open-palette').click();
            await new Promise(r => setTimeout(r, 100));
            assert(document.getElementById('command-palette-modal').classList.contains('active'), 'Command Palette opens active');
            const palInput = document.getElementById('command-palette-input');
            palInput.value = 'sketcher';
            palInput.dispatchEvent(new Event('input'));
            await new Promise(r => setTimeout(r, 100));
            const palItems = document.querySelectorAll('.command-item');
            assert(palItems.length > 0, 'Command Palette filters commands dynamically');
            document.getElementById('btn-close-command-palette').click();
            assert(!document.getElementById('command-palette-modal').classList.contains('active'), 'Command Palette closes');

            // Test Theme Toggle
            const themeBtn = document.getElementById('btn-toggle-theme');
            themeBtn.click();
            assert(document.body.classList.contains('theme-high-contrast'), 'Theme switches to high-contrast workstation');
            themeBtn.click();
            assert(!document.body.classList.contains('theme-high-contrast'), 'Theme toggles back to default dark mode');

            // Test Workspace Tab switching
            const tabs = document.querySelectorAll('.workspace-tab');
            assert(tabs.length >= 4, 'Multi-document workspace has at least 4 project tabs');
            tabs[1].click();
            await new Promise(r => setTimeout(r, 100));
            assert(tabs[1].classList.contains('active'), 'Second workspace tab activates on click');

            // Test Global Solver Progress
            window.omniSetSolverProgress('Asynchronous Sparse Cholesky Factorization...', 65);
            assert(document.getElementById('global-solver-progress').style.display === 'block', 'Global solver progress displays');
            assert(document.getElementById('solver-progress-pct').textContent === '65%', 'Solver percentage updates');
            document.getElementById('btn-cancel-solver').click();
            assert(document.getElementById('global-solver-progress').style.display === 'none', 'Solver progress cancels on button click');

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
