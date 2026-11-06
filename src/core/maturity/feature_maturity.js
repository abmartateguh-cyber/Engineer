'use strict';

const MATURITY_STATES = Object.freeze({
  RELEASED: 'released',
  CORRELATED: 'correlated',
  EXPERIMENTAL: 'experimental',
  UNAVAILABLE: 'unavailable'
});

const DOMAIN_MATURITY = Object.freeze({
  cad: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'GeometryEngineAdapter',
    capabilities: Object.freeze([
      'Surface Evaluation and Sampled Intersection Tracing',
      'Experimental Edge-Blend Operation',
      'Assembly Mate and 2D Sketch Constraint Solving',
      'STEP AP214 Serialization'
    ]),
    summary:
      'Experimental geometry adapter with limited numerical and format paths; robust B-rep operations, exact predicates, general STEP conformance, and independent validation are not established.'
  }),
  cam: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'CAMEngineAdapter',
    capabilities: Object.freeze([
      'Experimental 3-Axis Constant-Z Planar Roughing Toolpath Generation',
      'Illustrative ISO/Fanuc-Style G-Code Text from Experimental Roughing Route'
    ]),
    summary:
      'Experimental constant-Z 3-axis roughing and illustrative G-code generation; no 5-axis RTCP, trochoidal strategy, collision checking, or machine-validated post-processor is provided.'
  }),
  cae: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'FEAEngineAdapter',
    capabilities: Object.freeze([
      'Experimental Caller-Mesh 3D Linear-Elastic FEA Route',
      'Caller-Input Simplified Drop-Test Simulation Route'
    ]),
    summary:
      'Experimental linear-elastic caller-mesh FEA and simplified drop-test routes. Nonlinear material, contact, thermal, and modal operations are not exposed by this adapter; independent validation is pending.'
  }),
  cfd: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'CFDEngineAdapter',
    capabilities: Object.freeze([
      'Experimental 3D FVM Navier-Stokes Box-Flow Step (direct IPC route; adapter not wired)',
      'Experimental k-omega SST Transport and Automatic Wall Treatment',
      'Experimental HLLC/Roe/AUSM Fluxes and Moving Reference Frame Sources'
    ]),
    summary:
      'Experimental FVM code is directly reachable through a CAE IPC step route but bypasses CFDEngineAdapter; the NASA TMR flat-plate comparison fails, and SIMPLE/VOF and sliding-mesh coupling are not provided by this route.'
  }),
  aerospace: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'AerospaceEngineAdapter',
    capabilities: Object.freeze([
      'Experimental Rocket-Propulsion Performance, Combustion, and Staging Estimates',
      'Caller-Input Rocket Ascent-Trajectory Estimate',
      'Hohmann and Bi-Elliptic Orbital-Transfer Delta-V Estimate',
      'Experimental Regenerative-Cooling, Turbopump, and Isogrid Helpers',
      'Experimental Supersonic Shock-Expansion Estimate'
    ]),
    summary:
      'Experimental adapter operations cover rocket propulsion, caller-input ascent trajectory, two-impulse orbital transfer, cooling/turbopump, isogrid, and shock-expansion estimates. No 6-DOF RK45 flight-dynamics, VLM, flutter, J2, or Lambert solver is exposed.'
  }),
  controls: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'ControlsEngineAdapter',
    capabilities: Object.freeze([
      'Continuous/Discrete State-Space LTI Simulation & Discretization',
      'CARE/DARE Riccati Solver for LQR Optimal Control',
      'Experimental Extended Kalman Filter State-Estimation Estimate',
      'Linear Model Predictive Control (MPC) Active-Set QP',
      'Experimental Bode Response from Caller Transfer-Function Coefficients'
    ]),
    summary:
      'Experimental state-space, direct-IPC LQR/Bode helpers, MPC, and EKF operations; the adapter does not provide LQG or Nyquist/stability-margin analysis, and hardware-in-the-loop sign-off is pending.'
  }),
  robotics: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'RoboticsEngineAdapter',
    capabilities: Object.freeze([
      '6-DOF/7-DOF DH/PoE Forward Kinematics',
      'Damped Least-Squares Inverse Kinematics',
      'Recursive Newton-Euler Inverse Dynamics',
      'Quintic Trajectory Planning',
      'URDF Parsing'
    ]),
    summary:
      'Experimental robotics kinematics and dynamics adapter covering 6-DOF/7-DOF DH/PoE Forward Kinematics, Damped Least-Squares Inverse Kinematics, Recursive Newton-Euler Inverse Dynamics, Quintic Trajectory Planning, and URDF Parsing.'
  }),
  eda: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'EDAEngineAdapter',
    capabilities: Object.freeze([
      'Experimental Circuit Simulation, Timing, and Logic Routes',
      'Experimental Placement, Routing, and Rectangle Rule Checks',
      'Limited Layout Serialization and Parasitic Estimation Routes',
      'Caller-Input Signal Integrity and Power Estimation Routes'
    ]),
    summary:
      'Experimental EDA adapter with limited circuit, timing, layout, serialization, and estimation helpers. These routes do not establish foundry extraction, sign-off, or complete-format conformance.'
  }),
  optics: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'OpticsEngineAdapter',
    capabilities: Object.freeze([
      '3D Non-Sequential Vector Snell/Fresnel Ray Tracing & Sellmeier Dispersion',
      '2D Radix-2 FFT Diffraction PSF, Wavefront OPD & MTF Evaluation',
      'Transfer-Matrix Thin-Film Multilayer Coating Optimization'
    ]),
    summary:
      'Experimental non-sequential vector ray tracing with Sellmeier dispersion, 2D FFT diffraction PSF/MTF/OPD, and transfer-matrix thin-film coating adapter.'
  }),
  plant: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'PlantEngineAdapter',
    capabilities: Object.freeze([
      'IAPWS-IF97 Industrial Water & Steam Thermodynamic Properties (Regions 1, 2, 4, 5)',
      'Peng-Robinson Cubic EOS & Rachford-Rice Vapor-Liquid Equilibrium Flash',
      'Experimental ASME B31.3 Piping Stress & Geometry Estimate Helpers (no pipe-network solver)',
      'Experimental TEMA Shell-and-Tube Rating & Pinch Target Helpers (NTU-Effectiveness unavailable)'
    ]),
    summary:
      'Experimental process plant simulation adapter with IAPWS-IF97 steam tables (Regions 1, 2, 4, 5), Peng-Robinson VLE flash, and experimental pinch/TEMA/water-hammer helpers.'
  }),
  pdm: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'PDMEngineAdapter',
    capabilities: Object.freeze([
      'Caller-Supplied BOM Roll-Up, Serialization, and Where-Used Traversal',
      'Experimental Lifecycle-Rule Validation (not a persisted revision state machine)',
      'Caller-Supplied CAD Revision Geometry Diff (not Git/ECO change control)'
    ]),
    summary:
      'Experimental caller-supplied BOM helpers, lifecycle-rule validation, and geometric revision comparison. Merkle storage, persistent revision management, RBAC/signatures, ECO workflow, and vault locking are not implemented by this adapter.'
  }),
  hpc: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'HPCEngineAdapter',
    capabilities: Object.freeze([
      'In-Memory Recursive Coordinate Bisection (RCB) Point Partitioning',
      'SLURM/PBS Pro Job Script Templates (submission and remote execution unavailable)',
      'Local PersistentWorkerPool Task Dispatch',
      'Caller-Assumption Storage-Use Estimate (not out-of-core I/O)'
    ]),
    summary:
      'Experimental in-memory partitioning, local worker dispatch, caller-assumption storage estimation, and scheduler script templates; no remote scheduler submission, distributed halo exchange, or out-of-core I/O is implemented.'
  }),
  cosim: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'FMICoSimulationMaster',
    capabilities: Object.freeze([
      'FMI Master Operation (dedicated domain adapter not registered; IPC route unavailable)'
    ]),
    summary:
      'FMI master helper modules are experimental; no co-simulation operation is exposed by ControlsEngineAdapter, the dedicated domain is not registered in EngineRegistry, and the IPC FMU route is declared unavailable.'
  }),
  dynamic_simulink: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'BlockDiagramSimulator',
    capabilities: Object.freeze([
      'Causal Block-Diagram Topological Sorting & Algebraic Loop Detection',
      'Fixed-Step Explicit Block Simulation for Implemented Block Types',
      'Source, Gain, Sum, Integrator, PID, and Scope Blocks (no zero-crossing or transfer-function block)'
    ]),
    summary:
      'Experimental fixed-step block-diagram route using explicit updates for a limited block set; feedback cycles, variable-step integration, zero-crossing semantics, and transfer-function blocks are not implemented.'
  }),
  materials: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'MaterialDatabase',
    capabilities: Object.freeze([
      'Caller-Supplied Material Records for Experimental Formula Helpers (no reviewed catalog)'
    ]),
    summary: 'No reviewed material-property catalog, qualified product adapter, or certified allowables are configured.'
  }),
  math: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'WasmSparseMultifrontalSolver',
    capabilities: Object.freeze([
      'Nested-Dissection and Minimum-Degree Leaf Ordering',
      'Sparse Cholesky and 2D DST-I Poisson Solver',
      'Preconditioned Conjugate Gradient & Dense Gaussian Elimination'
    ]),
    summary:
      'Experimental sparse direct and iterative linear-algebra helpers. Local manufactured checks exist, but independent solver evidence remains incomplete.'
  }),
  compliance: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'StandardsComplianceEngine',
    capabilities: Object.freeze(['Rule-Based Engineering Margin & Factor-of-Safety Checks']),
    summary: 'Rule-based engineering margin evaluation; not a substitute for formal regulatory certification.'
  }),
  reporting: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'AuditReportGenerator',
    capabilities: Object.freeze([
      'SHA-256 hashing of supplied artifacts',
      'Experimental domain maturity and diagnostic HTML/JSON reports'
    ]),
    summary: 'Experimental report generation; independent review and signature verification are unavailable.'
  }),
  security: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'IntegrityVerifier',
    capabilities: Object.freeze([
      'SHA-256 Content-Addressed Blob Integrity Helpers (local project storage)',
      'Stenographer HMAC Hash-Chained Ledger Verification (local ledger only)'
    ]),
    summary: 'Cryptographic integrity and hash-chain verification utilities.'
  }),
  storage: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'ProjectWorkspaceStore',
    capabilities: Object.freeze(['Local Project Archive Serialization and Content-Addressed Artifact Storage']),
    summary:
      'Local serialization and content-addressed artifact storage exist; end-to-end WAL recovery and snapshot checkpointing are not wired into production UI workflows.'
  }),
  ai: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'StenographerSupervisor',
    capabilities: Object.freeze([
      'Fail-Closed Tool Proposal & Human-in-the-Loop Approval Gateway',
      'Immutable SHA-256 Hash-Chained Engineering Ledger'
    ]),
    summary: 'Stenographer fail-closed AI tool governance and hash-chained engineering audit ledger.'
  }),
  system: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'SystemIpcServices',
    capabilities: Object.freeze(['Local project, workstation, and system IPC services']),
    summary:
      'Experimental system-domain IPC services; they do not represent a numerical engineering solver or release-approved capability.'
  }),
  vv: Object.freeze({
    state: MATURITY_STATES.EXPERIMENTAL,
    status: MATURITY_STATES.EXPERIMENTAL,
    releaseApproved: false,
    adapter: 'VVRegistry',
    capabilities: Object.freeze([]),
    summary:
      'V&V readiness and diagnostic reporting. Independent reference artifacts and qualified production solver comparisons are unavailable for multiple cases; smoke results do not establish validation.'
  })
});

// Unregistered domains fail closed to experimental, never approved.
const UNKNOWN_DOMAIN = Object.freeze({
  state: MATURITY_STATES.EXPERIMENTAL,
  status: MATURITY_STATES.EXPERIMENTAL,
  releaseApproved: false,
  summary: 'No maturity record is registered for this domain; treated as experimental.'
});

function getFeatureMaturity(domain) {
  if (typeof domain !== 'string') return UNKNOWN_DOMAIN;
  return DOMAIN_MATURITY[domain.trim().toLowerCase()] || UNKNOWN_DOMAIN;
}

/** Returns detached copies so callers cannot mutate the frozen registry. */
function listFeatureMaturity() {
  return Object.fromEntries(Object.entries(DOMAIN_MATURITY).map(([domain, maturity]) => [domain, { ...maturity }]));
}

function isReleaseApproved(domain) {
  const maturity = getFeatureMaturity(domain);
  return maturity.state === MATURITY_STATES.RELEASED && maturity.releaseApproved === true;
}

function listCorrelatedDomains(registry = DOMAIN_MATURITY) {
  return Object.entries(registry)
    .filter(([, entry]) => entry.status === MATURITY_STATES.CORRELATED)
    .map(([domain]) => domain);
}

function getDomainMaturity(domain) {
  if (typeof domain !== 'string') return null;
  const normalized = domain.trim().toLowerCase();
  return DOMAIN_MATURITY[normalized] || null;
}

function getAllDomainMaturity() {
  return Object.entries(DOMAIN_MATURITY).map(([domain, entry]) => ({
    domain,
    ...entry
  }));
}

function getMaturitySummary() {
  const entries = Object.entries(DOMAIN_MATURITY);
  const byStatus = {
    released: 0,
    correlated: 0,
    experimental: 0,
    unavailable: 0
  };
  for (const [, entry] of entries) {
    const s = entry.status || entry.state || 'experimental';
    if (byStatus[s] !== undefined) {
      byStatus[s] += 1;
    }
  }
  return {
    totalDomains: entries.length,
    byStatus,
    correlatedDomains: listCorrelatedDomains(),
    releaseApprovedCount: entries.filter(([, e]) => e.releaseApproved === true).length
  };
}

function getReleaseGatedDomains() {
  return Object.entries(DOMAIN_MATURITY)
    .filter(([, entry]) => !entry.releaseApproved)
    .map(([domain, entry]) => ({ domain, ...entry }));
}

module.exports = {
  MATURITY_STATES,
  DOMAIN_MATURITY,
  FEATURE_MATURITY: DOMAIN_MATURITY,
  getFeatureMaturity,
  listFeatureMaturity,
  getDomainMaturity,
  getAllDomainMaturity,
  getMaturitySummary,
  getReleaseGatedDomains,
  isReleaseApproved,
  listCorrelatedDomains
};
