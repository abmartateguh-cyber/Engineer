'use strict';

/**
 * Generates docs/industrialization/capability_matrix.md from the live source
 * registries:
 *   - src/core/maturity/feature_maturity.js  (DOMAIN_MATURITY capabilities)
 *   - src/core/contracts/engine_registry.js (registered domain adapters)
 *   - src/main/ipc/index.js + handlers        (registered IPC channels + domains)
 *   - preload.js                              (renderer surface per channel)
 *   - src/ui/** and headless entry points     (UI/headless route usage)
 *
 * The matrix is an engineering audit artifact: every cell is derived from
 * textual/structural evidence in the sources listed above. Where no verified
 * route exists the cell is marked "gap: ...". Nothing is inferred or assumed
 * beyond the recorded registries. No network access is used.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(ROOT_DIR, 'docs', 'industrialization', 'capability_matrix.md');
const PRELOAD_PATH = path.join(ROOT_DIR, 'preload.js');
const ENGINE_REGISTRY_PATH = path.join(ROOT_DIR, 'src', 'core', 'contracts', 'engine_registry.js');
const UI_ROUTE_ROOTS = [
  path.join(ROOT_DIR, 'src', 'ui'),
  path.join(ROOT_DIR, 'main.js'),
  path.join(ROOT_DIR, 'src', 'main', 'headless_solver_daemon.js')
];

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'for',
  'with',
  'without',
  'of',
  'in',
  'on',
  'at',
  'to',
  'from',
  'by',
  'as',
  'is',
  'are',
  'be',
  'being',
  'into',
  'via',
  'using',
  'route',
  'routes',
  'experimental',
  'limited',
  'caller',
  'input',
  'inputs',
  'supplied',
  'operations',
  'operation',
  'status',
  'run',
  'running',
  'example',
  'examples',
  'explicit',
  'return',
  'returns',
  'generate',
  'generated',
  'available',
  'unavailable',
  'pending',
  'review',
  'reviewed',
  'source',
  'sourced',
  'independent',
  'independently',
  'validated',
  'validation',
  'estimated',
  'estimate',
  'estimates',
  'compute',
  'computed',
  'calculate',
  'calculated',
  'solve',
  'solved',
  'solver',
  'solution',
  'sample',
  'check',
  'checks',
  'report',
  'reported',
  'data',
  'set',
  'sets',
  'problem',
  'model',
  'models',
  'system',
  'systems',
  'form',
  'forms',
  'formula',
  'formulas',
  'simulate',
  'simulation',
  'integrate',
  'integration',
  'iterative',
  'scale',
  'scales',
  'mixed',
  'small',
  'large',
  'type',
  'types',
  'uses',
  'use',
  'used',
  'based',
  'rate',
  'rates',
  'level',
  'levels',
  'value',
  'values',
  'total',
  'part',
  'parts',
  'local',
  'global',
  'general',
  'simple',
  'original',
  'standard',
  'full',
  'true',
  'false',
  'null',
  'non',
  'no',
  'yes',
  'unknown',
  'provisional',
  'target',
  'targets',
  'expected',
  'measured',
  'compare',
  'compared',
  'comparison',
  'code',
  'coded',
  'module',
  'modules',
  'file',
  'files',
  'format',
  'formats',
  'contents',
  'line',
  'lines',
  'space',
  'spaces',
  'point',
  'points',
  'grid',
  'grids',
  'mesh',
  'meshes',
  'edge',
  'edges',
  'face',
  'faces',
  'solid',
  'surface',
  'surfaces',
  'body',
  'bodies',
  'box',
  'domain',
  'domains',
  'geometry',
  'geometric',
  '2d',
  '3d',
  '1d',
  'x',
  'y',
  'z',
  'si',
  'mm',
  'm',
  'pa',
  'n',
  'hz',
  'w',
  'k',
  'g',
  'kg',
  's',
  'ms',
  'samples',
  'time',
  'times',
  'per',
  'each',
  'other',
  'two',
  'one',
  'more',
  'most',
  'all',
  'any',
  'some',
  'also',
  'only',
  'well',
  'over',
  'under',
  'up',
  'down',
  'out',
  'off',
  'below',
  'above',
  'within',
  'including',
  'such',
  'like',
  'than',
  'then',
  'there',
  'here',
  'this',
  'that',
  'these',
  'those',
  'its',
  'their',
  'his',
  'her',
  'was',
  'were',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'can',
  'cannot',
  'not',
  'so',
  'if',
  'but',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'what',
  'how',
  'why',
  'between',
  'among',
  'against',
  'during',
  'before',
  'after',
  'since',
  'until',
  'while',
  'once',
  'although',
  'though',
  'because',
  'unless',
  'whether',
  'yet',
  'both',
  'either',
  'neither',
  'few',
  'several',
  'many',
  'much',
  'little',
  'less',
  'least',
  'most',
  'some',
  'no',
  'none',
  'nothing',
  'everything',
  'something',
  'anything',
  'every',
  'multi',
  'control',
  'controller',
  'controllers',
  'engineering',
  'mechanics',
  'analysis',
  'analytical',
  'analytically',
  'theory',
  'theoretical',
  'classical',
  'classic',
  'standard',
  'canonical',
  'published',
  'publication',
  'reference',
  'references',
  'criterion',
  'criteria',
  'scheme',
  'schema',
  'method',
  'methods',
  'structural',
  'graphic',
  'graphics',
  'visual',
  'visuals',
  'image',
  'images',
  'assets'
]);

const STRONG_NAMES = new Set([
  'step',
  'gerber',
  'gdsii',
  'spice',
  'verilog',
  'lqr',
  'mpc',
  'bode',
  'nyquist',
  'kalman',
  'riccati',
  'rcwa',
  'mtf',
  'opd',
  'iapws',
  'peng',
  'hardy',
  'npsha',
  'vle',
  'merkle',
  'eco',
  'rbac',
  'sha256',
  'fmi',
  'urdf',
  'rtcp',
  'bvh',
  'vlm',
  'kepler',
  'lambert',
  'theodorsen',
  'hllc',
  'roe',
  'vof',
  'mrf',
  'sst',
  'schoenherr',
  'karman',
  'snell',
  'fresnel',
  'sellmeier',
  'ap214',
  'ap242',
  'gdt',
  'mitc4',
  'timoshenko',
  'kirsch',
  'lame',
  'poiseuille',
  'rayleigh',
  'mms',
  'cholesky',
  'multifrontal',
  'pcg',
  'amdahl',
  'gustafson',
  'rcb',
  'fiedler',
  'backfill',
  'halo',
  'allreduce',
  'checkpoint',
  'restart',
  'hohmann',
  'prandtl',
  'meyer',
  'venkatakrishnan',
  'nrtl',
  'dippr',
  'api520',
  'tema',
  'bell',
  'delaware',
  'isa',
  'autosar',
  'swc',
  'pkcs11',
  'mcdc',
  'lef',
  'def',
  'sky130',
  'dst',
  'fea',
  'fem',
  'cfd',
  'fvm',
  'hex20',
  'tet4',
  'tet10',
  'fft',
  'iso',
  'ppm',
  'pfd',
  'pid',
  'bom',
  'ebom',
  'wip',
  'cae',
  'cad',
  'eda',
  'pdm',
  'hpc',
  'j2',
  'rao',
  'laval',
  'ausm',
  'gcode',
  'fanuc',
  'siemens',
  'heidenhain',
  'dq',
  'moc',
  'prv',
  'gcm',
  'aes',
  'hmac',
  'ecdsa',
  'rsa',
  'sha',
  'snap',
  'pmi',
  'gtol'
]);

const PREFIX_MIN_LENGTH = 5;

// Every capability-to-route association below is manually reviewed. Unknown
// capability rows intentionally remain gaps; semantic token overlap is not
// accepted as evidence that an IPC handler implements an engineering method.
const CAPABILITY_ROUTE_BINDINGS = Object.freeze({
  'cad|Surface Evaluation and Sampled Intersection Tracing': {
    channels: ['omni:evaluate-nurbs', 'omni:intersect-basic-nurbs-ssi'],
    engineModules: ['src/core/cad/nurbs_engine.js', 'src/core/cad/nurbs_trimmed_ssi.js']
  },
  'cad|Experimental Edge-Blend Operation': {
    channels: ['omni:apply-edge-blend'],
    engineModules: ['src/core/cad/edge_blender.js']
  },
  'cad|Assembly Mate and 2D Sketch Constraint Solving': {
    channels: ['omni:solve-assembly-mates', 'omni:solve-variational-sketch'],
    engineModules: ['src/core/cad/assembly_mates.js', 'src/core/cad/variational_constraint_solver.js']
  },
  'cad|STEP AP214 Serialization': {
    channels: ['omni:export-step'],
    engineModules: ['src/core/cad/step_translator.js']
  },
  'cam|Experimental 3-Axis Constant-Z Planar Roughing Toolpath Generation': {
    channels: ['omni:cam-generate-toolpath'],
    engineModules: ['src/core/cam/cnc_toolpath_engine.js'],
    adapterOperation: 'plan_roughing_toolpath',
    adapterDomain: 'cam'
  },
  'cam|Illustrative ISO/Fanuc-Style G-Code Text from Experimental Roughing Route': {
    channels: ['omni:cam-generate-toolpath'],
    engineModules: ['src/core/cam/cnc_toolpath_engine.js'],
    adapterOperation: 'generate_gcode',
    adapterDomain: 'cam'
  },
  'cae|Experimental Caller-Mesh 3D Linear-Elastic FEA Route': {
    channels: ['omni:solve-fea-hex20'],
    engineModules: ['src/core/cae/fea_structural.js']
  },
  'cae|Caller-Input Simplified Drop-Test Simulation Route': {
    channels: ['omni:solve-drop-test'],
    engineModules: ['src/core/cae/drop_test.js']
  },
  'cfd|Experimental 3D FVM Navier-Stokes Box-Flow Step (direct IPC route; adapter not wired)': {
    channels: ['omni:solve-fvm-cfd-3d'],
    engineModules: ['src/core/cae/fvm_navier_stokes_3d.js'],
    limitation:
      'direct CAE IPC route bypasses CFDEngineAdapter; the operation is experimental and fails the NASA TMR comparison'
  },
  'cfd|Experimental k-omega SST Transport and Automatic Wall Treatment': {
    channels: ['omni:solve-fvm-cfd-3d'],
    engineModules: ['src/core/cae/fvm_navier_stokes_3d.js'],
    limitation: 'closure is present in the direct experimental FVM route; it is not independently validated'
  },
  'cfd|Experimental HLLC/Roe/AUSM Fluxes and Moving Reference Frame Sources': {
    channels: ['omni:solve-fvm-cfd-3d', 'omni:solve-transonic-riemann'],
    engineModules: ['src/core/cae/fvm_navier_stokes_3d.js', 'src/core/cae/transonic_riemann_solver.js'],
    limitation: 'these numerical options are experimental and not qualified for compressible-flow signoff'
  },
  'aerospace|Experimental Rocket-Propulsion Performance, Combustion, and Staging Estimates': {
    channels: ['omni:solve-nasa-rocket'],
    engineModules: ['src/core/aerospace/nasa_rocket_propulsion.js'],
    limitation: 'direct IPC calculation helpers are experimental; no 6-DOF flight dynamics are implied'
  },
  'aerospace|Caller-Input Rocket Ascent-Trajectory Estimate': {
    channels: ['omni:solve-nasa-rocket'],
    engineModules: ['src/core/aerospace/nasa_rocket_propulsion.js'],
    limitation: 'trajectory helper is not a 6-DOF or RK45 flight-dynamics solver'
  },
  'aerospace|Hohmann and Bi-Elliptic Orbital-Transfer Delta-V Estimate': {
    channels: ['omni:calculate-orbital-transfer'],
    engineModules: ['src/core/aerospace/nasa_rocket_propulsion.js']
  },
  'aerospace|Experimental Regenerative-Cooling, Turbopump, and Isogrid Helpers': {
    channels: ['omni:solve-nasa-rocket'],
    engineModules: ['src/core/aerospace/nasa_rocket_propulsion.js'],
    limitation: 'caller-input calculation helpers are not independently validated'
  },
  'aerospace|Experimental Supersonic Shock-Expansion Estimate': {
    channels: ['omni:run-aerospace-cfd'],
    engineModules: ['src/core/aerospace/nasa_rocket_propulsion.js']
  },
  'controls|Continuous/Discrete State-Space LTI Simulation & Discretization': {
    channels: ['omni:solve-state-space-lti'],
    engineModules: ['src/core/dynamic_simulink/block_graph.js'],
    adapterOperation: 'solve_state_space',
    adapterDomain: 'controls'
  },
  'controls|CARE/DARE Riccati Solver for LQR Optimal Control': {
    channels: ['omni:synthesize-lqr'],
    engineModules: ['src/core/dynamic_simulink/state_space_engine.js']
  },
  'controls|Experimental Extended Kalman Filter State-Estimation Estimate': {
    channels: ['omni:estimate-ekf'],
    engineModules: ['src/core/dynamic_simulink/extended_kalman_filter.js'],
    adapterOperation: 'estimate_ekf',
    adapterDomain: 'controls'
  },
  'controls|Linear Model Predictive Control (MPC) Active-Set QP': {
    channels: ['omni:solve-mpc'],
    engineModules: ['src/core/dynamic_simulink/model_predictive_control.js']
  },
  'controls|Experimental Bode Response from Caller Transfer-Function Coefficients': {
    channels: ['omni:solve-bode'],
    engineModules: ['src/core/dynamic_simulink/frequency_analysis.js']
  },
  'robotics|6-DOF/7-DOF DH/PoE Forward Kinematics': {
    channels: ['omni:run-robotics-operation'],
    engineModules: ['src/core/robotics/serial_manipulator_kinematics.js']
  },
  'robotics|Damped Least-Squares Inverse Kinematics': {
    channels: ['omni:run-robotics-operation'],
    engineModules: ['src/core/robotics/serial_manipulator_kinematics.js']
  },
  'robotics|Recursive Newton-Euler Inverse Dynamics': {
    channels: ['omni:run-robotics-operation'],
    engineModules: ['src/core/robotics/serial_manipulator_kinematics.js']
  },
  'robotics|Quintic Trajectory Planning': {
    channels: ['omni:run-robotics-operation'],
    engineModules: ['src/core/robotics/serial_manipulator_kinematics.js']
  },
  'robotics|URDF Parsing': {
    channels: ['omni:run-robotics-operation'],
    engineModules: ['src/core/robotics/robotics_engine_adapter.js']
  },
  'eda|Experimental Circuit Simulation, Timing, and Logic Routes': {
    channels: ['omni:solve-spice-circuit', 'omni:run-mcmm-sta', 'omni:synthesize-verilog'],
    engineModules: [
      'src/core/eda/spice_request.js',
      'src/core/eda/mcmm_sta_engine.js',
      'src/core/eda/logic_synthesis.js'
    ]
  },
  'eda|Experimental Placement, Routing, and Rectangle Rule Checks': {
    channels: ['omni:eda-place-and-route', 'omni:run-drc'],
    engineModules: ['src/core/eda/place_and_route_engine.js', 'src/core/eda/drc_engine.js']
  },
  'eda|Limited Layout Serialization and Parasitic Estimation Routes': {
    channels: ['omni:export-gdsii', 'omni:export-gerber', 'omni:extract-pex-3d'],
    engineModules: [
      'src/core/eda/gdsii_stream.js',
      'src/core/eda/gerber_exporter.js',
      'src/core/eda/parasitic_extraction_3d.js'
    ]
  },
  'eda|Caller-Input Signal Integrity and Power Estimation Routes': {
    channels: ['omni:evaluate-signal-integrity-power'],
    engineModules: ['src/core/eda/signal_integrity_crosstalk.js', 'src/core/eda/power_grid_ir_drop.js']
  },
  'optics|3D Non-Sequential Vector Snell/Fresnel Ray Tracing & Sellmeier Dispersion': {
    channels: ['omni:solve-skew-optics'],
    engineModules: ['src/core/optics/non_sequential_tracer.js', 'src/core/optics/optical_materials.js']
  },
  'optics|2D Radix-2 FFT Diffraction PSF, Wavefront OPD & MTF Evaluation': {
    channels: ['omni:evaluate-wavefront-psf'],
    engineModules: ['src/core/optics/diffraction_psf_mtf.js']
  },
  'optics|Transfer-Matrix Thin-Film Multilayer Coating Optimization': {
    channels: ['omni:evaluate-thin-film-coating'],
    engineModules: ['src/core/optics/aspheric_freeform_optics.js']
  },
  'plant|IAPWS-IF97 Industrial Water & Steam Thermodynamic Properties (Regions 1, 2, 4, 5)': {
    channels: ['omni:calculate-steam-properties'],
    engineModules: ['src/core/plant/iapws_if97.js'],
    headlessOperation: 'calculate_steam_properties'
  },
  'plant|Peng-Robinson Cubic EOS & Rachford-Rice Vapor-Liquid Equilibrium Flash': {
    channels: ['omni:flash-peng-robinson'],
    engineModules: ['src/core/plant/peng_robinson_eos.js']
  },
  'plant|Experimental ASME B31.3 Piping Stress & Geometry Estimate Helpers (no pipe-network solver)': {
    channels: ['omni:evaluate-piping-stress'],
    engineModules: ['src/core/plant/piping_network_3d.js']
  },
  'plant|Experimental TEMA Shell-and-Tube Rating & Pinch Target Helpers (NTU-Effectiveness unavailable)': {
    channels: ['omni:rate-tema-heat-exchanger'],
    engineModules: ['src/core/plant/heat_exchanger_tema.js']
  },
  'pdm|Caller-Supplied BOM Roll-Up, Serialization, and Where-Used Traversal': {
    channels: ['omni:rollup-ebom'],
    engineModules: ['src/core/pdm/engineering_bom_manager.js']
  },
  'pdm|Experimental Lifecycle-Rule Validation (not a persisted revision state machine)': {
    channels: ['omni:validate-lifecycle'],
    engineModules: ['src/core/pdm/pdm_engine_adapter.js'],
    adapterOperation: 'validate_lifecycle',
    adapterDomain: 'pdm'
  },
  'pdm|Caller-Supplied CAD Revision Geometry Diff (not Git/ECO change control)': {
    channels: ['omni:visual-diff-cad'],
    engineModules: ['src/core/pdm/git_cad_visual_diff.js']
  },
  'hpc|In-Memory Recursive Coordinate Bisection (RCB) Point Partitioning': {
    channels: ['omni:mesh-domain-decomposition'],
    engineModules: ['src/core/math/domain_decomposition.js'],
    adapterOperation: 'partition_rcb',
    adapterDomain: 'hpc',
    headlessOperation: 'partition_rcb'
  },
  'hpc|SLURM/PBS Pro Job Script Templates (submission and remote execution unavailable)': {
    engineModules: ['src/core/hpc/hpc_cluster_gateway.js'],
    headlessOperation: 'generate_slurm_script',
    limitation: 'headless template generation only; remote submission, polling, and cancellation are unavailable'
  },
  'hpc|Local PersistentWorkerPool Task Dispatch': {
    channels: ['omni:hpc-execute-local-parallel'],
    engineModules: ['src/core/math/worker_pool.js'],
    adapterOperation: 'execute_local_parallel',
    adapterDomain: 'hpc'
  },
  'hpc|Caller-Assumption Storage-Use Estimate (not out-of-core I/O)': {
    channels: ['omni:hpc-plan-out-of-core'],
    engineModules: ['src/core/hpc/hpc_cluster_gateway.js'],
    adapterOperation: 'plan_out_of_core',
    adapterDomain: 'hpc'
  },
  'cosim|FMI Master Operation (dedicated domain adapter not registered; IPC route unavailable)': {
    channels: ['omni:run-fmi-cosimulation'],
    engineModules: ['src/core/cosim/fmi_master_engine.js']
  },
  'dynamic_simulink|Causal Block-Diagram Topological Sorting & Algebraic Loop Detection': {
    channels: ['omni:simulate-block-diagram'],
    engineModules: ['src/core/dynamic_simulink/block_graph.js']
  },
  'dynamic_simulink|Fixed-Step Explicit Block Simulation for Implemented Block Types': {
    channels: ['omni:simulate-block-diagram'],
    engineModules: ['src/core/dynamic_simulink/block_graph.js']
  },
  'dynamic_simulink|Source, Gain, Sum, Integrator, PID, and Scope Blocks (no zero-crossing or transfer-function block)':
    {
      channels: ['omni:simulate-block-diagram'],
      engineModules: ['src/core/dynamic_simulink/block_graph.js']
    },
  'materials|Caller-Supplied Material Records for Experimental Formula Helpers (no reviewed catalog)': {
    channels: ['omni:compute-cuboid-mass-properties'],
    engineModules: ['src/core/materials/material_database.js']
  },
  'math|Nested-Dissection and Minimum-Degree Leaf Ordering': {
    channels: ['omni:solve-sparse-ordering'],
    engineModules: ['src/core/math/wasm_sparse_multifrontal.js']
  },
  'math|Sparse Cholesky and 2D DST-I Poisson Solver': {
    channels: ['omni:solve-sparse-cholesky'],
    engineModules: ['src/core/math/wasm_sparse_multifrontal.js']
  },
  'math|Preconditioned Conjugate Gradient & Dense Gaussian Elimination': {
    channels: ['omni:solve-pcg-dense'],
    engineModules: ['src/core/math/linear_algebra.js']
  },
  'security|SHA-256 Content-Addressed Blob Integrity Helpers (local project storage)': {
    channels: ['omni:add-blob', 'omni:get-blob'],
    engineModules: ['src/core/storage/omni_archive.js']
  },
  'security|Stenographer HMAC Hash-Chained Ledger Verification (local ledger only)': {
    channels: ['omni:stenographer-verify-ledger'],
    engineModules: ['src/core/compliance/immutable_audit_ledger.js']
  },
  'storage|Local Project Archive Serialization and Content-Addressed Artifact Storage': {
    channels: ['omni:add-blob', 'omni:get-blob'],
    engineModules: ['src/core/storage/omni_archive.js', 'src/core/storage/project_manager.js'],
    limitation: 'archive and blob routes exist; complete project recovery is not wired through the UI'
  },
  'storage|Crash-Recovery WAL Workflow Not Wired to Project Open/Save UI': {
    engineModules: ['src/core/storage/project_manager.js'],
    limitation: 'WAL recovery helper is not exercised by production project open/save UI workflows'
  },
  'ai|Fail-Closed Tool Proposal & Human-in-the-Loop Approval Gateway': {
    channels: [
      'omni:stenographer-get-proposals',
      'omni:stenographer-evaluate-proposal',
      'omni:stenographer-execute-tool'
    ],
    engineModules: ['src/main/stenographer_supervisor.js'],
    limitation: 'proposal UI review is not reachable through the normal visible OmniAI dock'
  },
  'ai|Immutable SHA-256 Hash-Chained Engineering Ledger': {
    channels: ['omni:stenographer-verify-ledger'],
    engineModules: ['src/core/compliance/immutable_audit_ledger.js'],
    limitation: 'local ledger integrity is not independent authorization or durable external anchoring'
  },
  'reporting|SHA-256 hashing of supplied artifacts': {
    channels: ['omni:hash-artifact-sha256'],
    engineModules: ['src/core/reporting/audit_report.js']
  },
  'reporting|Experimental domain maturity and diagnostic HTML/JSON reports': {
    channels: ['omni:generate-maturity-report'],
    engineModules: ['src/core/reporting/audit_report.js']
  },
  'compliance|Rule-Based Engineering Margin & Factor-of-Safety Checks': {
    channels: ['omni:evaluate-asme-viii-div2'],
    engineModules: ['src/core/compliance/asme_section_viii_div2.js']
  },
  'system|Local project, workstation, and system IPC services': {
    channels: ['omni:get-feature-maturity'],
    engineModules: ['src/main/ipc/system_ipc.js', 'src/core/maturity/feature_maturity.js']
  }
});

function significantTokens(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token) && !/^(?:19|20)\d\d$/.test(token));
}

function tokensOverlap(a, b) {
  if (a === b) return true;
  const minLength = Math.min(a.length, b.length);
  if (minLength < PREFIX_MIN_LENGTH) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function isUnavailableChannel(channel) {
  const description = channel.description || '';
  return (
    /^unavailable\b/i.test(description) ||
    /^withdrawn\b/i.test(description) ||
    /unavailable\s+(?:pending|until)/i.test(description)
  );
}

/**
 * Parses preload.js to map every exposed `omni:*` channel to the bridge
 * method name that invokes it. Returns { methods: Map<channel, method> }.
 */
function parsePreloadSurfaces(content) {
  const methods = new Map();
  const lines = content.split('\n');
  const singleLinePattern =
    /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*ipcRenderer\.invoke\(\s*['"](omni:[^'"]+)['"]/;
  const signaturePattern = /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;
  const invokePattern = /ipcRenderer\.invoke\(\s*['"](omni:[^'"]+)['"]/;
  let pendingMethod = null;
  for (const line of lines) {
    const inlineMatch = line.match(singleLinePattern);
    if (inlineMatch) {
      methods.set(inlineMatch[2], inlineMatch[1]);
      pendingMethod = null;
      continue;
    }
    const signatureMatch = line.match(signaturePattern);
    if (signatureMatch) {
      pendingMethod = signatureMatch[1];
      const inlineInvoke = line.match(invokePattern);
      if (inlineInvoke) {
        methods.set(inlineInvoke[1], pendingMethod);
        pendingMethod = null;
      }
      continue;
    }
    const invokeMatch = line.match(invokePattern);
    if (invokeMatch && pendingMethod) {
      methods.set(invokeMatch[1], pendingMethod);
      pendingMethod = null;
    }
  }
  return { methods };
}

function collectJsFiles(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectJsFiles(fullPath, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(fullPath);
    }
  }
}

/**
 * Scans renderer and headless sources for usage of preload bridge methods
 * (`omniEngAPI.<method>`) and raw `omni:*` channel strings.
 */
function collectUiRouteUsage() {
  const usedMethods = new Set();
  const usedChannels = new Set();
  const files = [];
  for (const root of UI_ROUTE_ROOTS) {
    if (!fs.existsSync(root)) continue;
    if (fs.statSync(root).isDirectory()) {
      collectJsFiles(root, files);
    } else {
      files.push(root);
    }
  }
  const methodPattern = /omniEngAPI\??\.([A-Za-z_$][\w$]*)/g;
  const channelPattern = /omni:[a-z0-9_-]+/g;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let methodMatch;
    while ((methodMatch = methodPattern.exec(content)) !== null) {
      usedMethods.add(methodMatch[1]);
    }
    let channelMatch;
    while ((channelMatch = channelPattern.exec(content)) !== null) {
      usedChannels.add(channelMatch[0]);
    }
  }
  const headlessPath = path.join(ROOT_DIR, 'src', 'main', 'headless_solver_daemon.js');
  const headlessSource = fs.existsSync(headlessPath) ? fs.readFileSync(headlessPath, 'utf8') : '';
  return { usedMethods, usedChannels, headlessSource };
}

/**
 * Pairs engine_registry.js constructor invocations (in registration order)
 * with the ordered domain list reported by the live registry.
 */
function loadRegisteredAdapters() {
  const source = fs.readFileSync(ENGINE_REGISTRY_PATH, 'utf8');
  const adapterNames = [...source.matchAll(/new\s+(\w+Adapter)\s*\(/g)].map((match) => match[1]);
  const { defaultEngineRegistry } = require(path.join(ROOT_DIR, 'src', 'core', 'contracts', 'engine_registry'));
  const domains = defaultEngineRegistry.listRegisteredDomains();
  const capabilities = defaultEngineRegistry.describeAllCapabilities();
  if (adapterNames.length !== domains.length) {
    throw new Error(
      `engine_registry.js adapter count (${adapterNames.length}) does not match registered domain count (${domains.length})`
    );
  }
  const byDomain = new Map();
  for (let index = 0; index < domains.length; index++) {
    const domain = domains[index];
    byDomain.set(domain, {
      name: adapterNames[index],
      supportedOperations: capabilities[domain]?.supportedOperations || []
    });
  }
  return byDomain;
}

function sortCandidates(candidates) {
  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.overlapsName) - Number(a.overlapsName) ||
      a.channel.channel.localeCompare(b.channel.channel)
  );
}

/**
 * Scores a capability against a channel (name + description tokens).
 * Verified when at least two significant tokens overlap, or when a single
 * strong/named token appears in the channel name itself.
 */
function matchCapability(capTokens, channels, allowSingleName) {
  const verified = [];
  for (const channel of channels) {
    const nameTokens = significantTokens(channel.channel.replace(/^omni:/, ''));
    const descriptionTokens = significantTokens(channel.description || '');
    const pool = new Set([...nameTokens, ...descriptionTokens]);
    const matched = new Set();
    for (const capToken of capTokens) {
      for (const poolToken of pool) {
        if (tokensOverlap(capToken, poolToken)) {
          matched.add(capToken);
          break;
        }
      }
    }
    const score = matched.size;
    const overlapsName = [...matched].some((capToken) =>
      nameTokens.some((nameToken) => tokensOverlap(capToken, nameToken))
    );
    let isVerified = score >= 2;
    if (!isVerified && allowSingleName && score === 1 && overlapsName) {
      const singleToken = [...matched][0];
      isVerified = STRONG_NAMES.has(singleToken) || singleToken.length >= 5;
    }
    if (isVerified) {
      verified.push({
        channel,
        score,
        matched: [...matched],
        overlapsName,
        unavailable: isUnavailableChannel(channel)
      });
    }
  }
  return sortCandidates(verified);
}

function selectIpcMatch(domainChannels, allChannels, capTokens) {
  const ownMatches = matchCapability(capTokens, domainChannels, true);
  const bestOwn = ownMatches[0] || null;
  if (bestOwn) {
    return { ...bestOwn, crossDomain: false };
  }
  if (domainChannels.length === 0) {
    const fallbackMatches = matchCapability(capTokens, allChannels, false);
    const bestFallback = fallbackMatches[0] || null;
    if (bestFallback) {
      return { ...bestFallback, crossDomain: true };
    }
  }
  return null;
}

function buildEvidence(adapterCell, ipcMatch, preloadCell, uiCell) {
  if (adapterCell.startsWith('gap:')) return adapterCell;
  if (!ipcMatch) return 'gap: no verified production path';
  if (ipcMatch.unavailable) return 'gap: matching route declared unavailable in handler description';
  if (preloadCell.startsWith('gap:')) return preloadCell;
  if (uiCell.startsWith('gap:')) return uiCell;
  return 'yes';
}

function formatIpcCell(ipcMatch) {
  if (!ipcMatch) return 'gap: no verified production path';
  const suffix = ipcMatch.crossDomain ? ` (routed via ${ipcMatch.channel.domain} IPC)` : '';
  const prefix = ipcMatch.unavailable ? 'gap: matching route declared unavailable (' : 'yes: ';
  return `${prefix}${ipcMatch.channel.channel}${ipcMatch.unavailable ? ')' : suffix}`;
}

function formatPreloadCell(ipcMatch, preloadMethods, exposedChannels) {
  if (!ipcMatch) return 'gap: no verified production path';
  const channel = ipcMatch.channel.channel;
  if (preloadMethods.has(channel)) return `yes: ${preloadMethods.get(channel)}`;
  if (exposedChannels.has(channel)) return 'yes (channel exposed in preload.js)';
  return 'gap: no preload surface';
}

function formatUiCell(ipcMatch, uiUsage, preloadMethods) {
  if (!ipcMatch) return 'gap: no verified production path';
  const method = preloadMethods.get(ipcMatch.channel.channel) || null;
  if ((method && uiUsage.usedMethods.has(method)) || uiUsage.usedChannels.has(ipcMatch.channel.channel)) {
    return 'yes';
  }
  return 'gap: no verified UI/headless route';
}

function buildCapabilityRow({ domain, capability, adaptersByDomain, channels, preloadMethods, uiUsage }) {
  const binding = CAPABILITY_ROUTE_BINDINGS[`${domain}|${capability}`];
  const adapterDomain = binding?.adapterDomain || domain;
  const adapter = adaptersByDomain.get(adapterDomain);
  const engineModules = binding?.engineModules || [];
  let engineCell;

  if (!binding) {
    engineCell = 'gap: no explicit capability-to-engine binding';
  } else if (binding.adapterOperation) {
    if (!adapter) {
      engineCell = `gap: no adapter registered for ${adapterDomain}`;
    } else if (!adapter.supportedOperations.includes(binding.adapterOperation)) {
      engineCell = `gap: ${adapter.name} does not advertise ${binding.adapterOperation}`;
    } else {
      engineCell = `yes: ${adapter.name}.${binding.adapterOperation}`;
    }
  } else if (engineModules.length > 0) {
    const missingModules = engineModules.filter((modulePath) => !fs.existsSync(path.join(ROOT_DIR, modulePath)));
    engineCell =
      missingModules.length > 0
        ? `gap: engine module missing (${missingModules.join(', ')})`
        : `yes: ${engineModules.join(', ')}${adapter ? ` (direct path; ${adapter.name} dispatch not established)` : ''}`;
  } else {
    engineCell = 'gap: no engine module or adapter operation is bound';
  }

  const boundChannels = (binding?.channels || []).map((channelName) =>
    channels.find((channel) => channel.channel === channelName)
  );
  const missingChannels = (binding?.channels || []).filter((channelName, index) => !boundChannels[index]);
  const unavailableChannels = boundChannels.filter((channel) => channel && isUnavailableChannel(channel));
  let ipcCell = 'gap: no explicit IPC binding';
  if (missingChannels.length > 0) {
    ipcCell = `gap: bound IPC channel not registered (${missingChannels.join(', ')})`;
  } else if (unavailableChannels.length > 0) {
    ipcCell = `gap: handler declares route unavailable (${unavailableChannels.map((channel) => channel.channel).join(', ')})`;
  } else if (boundChannels.length > 0) {
    ipcCell = `yes: ${boundChannels
      .map((channel) => `${channel.channel}${channel.domain !== domain ? ` (registered in ${channel.domain})` : ''}`)
      .join(', ')}`;
  }

  let preloadCell = 'gap: no explicit preload route';
  if (boundChannels.length > 0 && missingChannels.length === 0) {
    const missingPreload = boundChannels.filter((channel) => !preloadMethods.has(channel.channel));
    preloadCell = missingPreload.length
      ? `gap: channel not exposed in preload (${missingPreload.map((channel) => channel.channel).join(', ')})`
      : `yes: ${boundChannels.map((channel) => preloadMethods.get(channel.channel)).join(', ')}`;
  }

  let uiCell = 'gap: no verified renderer or headless call site';
  if (binding?.headlessOperation) {
    const operationPattern = new RegExp(`(?:operation|type)\\s*===\\s*['\"]${binding.headlessOperation}['\"]`);
    if (operationPattern.test(uiUsage.headlessSource)) {
      uiCell = `yes: headless_solver_daemon (${binding.headlessOperation})`;
    }
  }
  if (boundChannels.length > 0 && missingChannels.length === 0) {
    const methods = boundChannels.map((channel) => preloadMethods.get(channel.channel));
    if (methods.length > 0 && methods.every((method) => uiUsage.usedMethods.has(method))) {
      uiCell = `yes: renderer uses ${methods.join(', ')}`;
    }
  }

  const blockers = [];
  if (engineCell.startsWith('gap:')) blockers.push(engineCell.slice(5));
  if (ipcCell.startsWith('gap:')) blockers.push(ipcCell.slice(5));
  if (preloadCell.startsWith('gap:')) blockers.push(preloadCell.slice(5));
  if (uiCell.startsWith('gap:')) blockers.push(uiCell.slice(5));
  if (binding?.limitation) blockers.push(binding.limitation);
  const evidence = blockers.length === 0 ? 'yes: source-verified experimental route' : `gap: ${blockers.join('; ')}`;

  return {
    domain,
    capability,
    adapter: engineCell,
    ipc: ipcCell,
    preload: preloadCell,
    ui: uiCell,
    evidence
  };
}

function generateCapabilityMatrix() {
  const { DOMAIN_MATURITY } = require(path.join(ROOT_DIR, 'src', 'core', 'maturity', 'feature_maturity'));
  const { registerAllIpcHandlers, getRegisteredChannels } = require(path.join(ROOT_DIR, 'src', 'main', 'ipc'));
  registerAllIpcHandlers();
  const allChannels = getRegisteredChannels();

  const adaptersByDomain = loadRegisteredAdapters();
  const { methods: preloadMethods } = parsePreloadSurfaces(fs.readFileSync(PRELOAD_PATH, 'utf8'));
  const uiUsage = collectUiRouteUsage();

  const rows = [];
  let gapCount = 0;
  for (const [domain, maturity] of Object.entries(DOMAIN_MATURITY)) {
    for (const capability of maturity.capabilities) {
      const row = buildCapabilityRow({
        domain,
        capability,
        adaptersByDomain,
        channels: allChannels,
        preloadMethods,
        uiUsage
      });
      if (row.evidence.startsWith('gap:')) gapCount += 1;
      rows.push(row);
    }
  }

  const outputPath = process.env.OMNIENG_CAP_MATRIX_OUT || DEFAULT_OUTPUT_PATH;
  const tableHeader =
    '| Domain | Capability | Engine/Adapter | Production IPC path | Preload surface | UI/headless route | Evidence status |';
  const tableDivider = '|---|---|---|---|---|---|---|';
  const tableRows = rows.map(
    (row) =>
      `| ${row.domain} | ${row.capability} | ${row.adapter} | ${row.ipc} | ${row.preload} | ${row.ui} | ${row.evidence} |`
  );

  const document = `# OmniEng Capability Matrix

> Engineering audit artifact generated by \`scripts/generate_capability_matrix.js\` from the live source registries and an explicit capability-to-route binding manifest. This matrix records source-verified routes; it is not certification evidence and does not assert numerical accuracy, compliance, or release maturity.

## Inputs read by the generator

- \`src/core/maturity/feature_maturity.js\` — \`DOMAIN_MATURITY\` registry (domains + advertised capabilities).
- \`src/core/contracts/engine_registry.js\` — registered domain adapters (constructor order paired with \`listRegisteredDomains()\`).
- \`src/main/ipc/index.js\` + \`src/main/ipc/*.js\` — registered \`omni:*\` channels and their declared domain/description metadata.
- \`preload.js\` — renderer bridge methods that invoke each channel.
- \`src/ui/**/*.js\`, \`main.js\`, \`src/main/headless_solver_daemon.js\` — UI/headless usage of bridge methods or channels.

## Convention

- Cells are \`yes: <verified identifier>\` when the identifier was found in the corresponding source, or \`gap: <reason>\` when it could not be verified. Nothing beyond the sources above is asserted.
- A channel whose registration description declares itself unavailable (contains "unavailable" or "withdrawn") is treated as a non-functional route: the channel and preload surface remain visible, but the evidence status is a gap.
- A route appears in a row only when its exact capability binding is listed in \`CAPABILITY_ROUTE_BINDINGS\` and the referenced channel, preload method, module/adapter operation, and renderer/headless use are present. Unmapped rows remain explicit gaps. A \`yes\` indicates a wired source path only, not verified accuracy or release readiness.

## Matrix (${rows.length} capability rows, ${gapCount} gap cells)

${tableHeader}
${tableDivider}
${tableRows.join('\n')}

## Gap summary

The following advertised capabilities have no verified production route:

${
  rows
    .filter((row) => row.evidence.startsWith('gap:'))
    .map(
      (row) =>
        `- \`${row.domain}\` — "${row.capability}": ${row.evidence} (IPC: ${row.ipc}; preload: ${row.preload}; UI: ${row.ui})`
    )
    .join('\n') || '- none'
}
`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, document, 'utf8');
  return { outputPath, rowCount: rows.length, gapCount, document };
}

module.exports = {
  generateCapabilityMatrix,
  CAPABILITY_ROUTE_BINDINGS,
  significantTokens,
  tokensOverlap,
  matchCapability
};

if (require.main === module) {
  try {
    const result = generateCapabilityMatrix();
    console.log(result.outputPath);
  } catch (error) {
    console.error(`[generate_capability_matrix] generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
