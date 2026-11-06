# ISO 26262 Safety Case Evidence Dossier — OmniEng Engineering Tool Suite

| Field                   | Value                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Document ID             | OMN-IND-CERT-ISO26262-001                                                                                                |
| Version                 | 0.3.0 (draft)                                                                                                            |
| Date                    | 2026-11-02                                                                                                               |
| Document class          | Working evidence dossier — **not** a safety case, not a certificate                                                      |
| Target confidence level | TCL1 / ASIL-D context (provisional target, not granted)                                                                  |
| Applicable standard     | ISO 26262:2018 (functional safety for road vehicles), in particular Part 8 §11 (confidence in the use of software tools) |
| Status                  | **NOT YET CERTIFIED**                                                                                                    |

## 1. Purpose and scope

This dossier records the current state of evidence for developing a safety
case around the OmniEng engineering tool suite ("the Tool") when used in a
road-vehicle functional safety context. It is an internal industrialization
artifact for the R0 release train. It does **not** grant, claim, or imply ISO
26262 compliance, a safety case approval, a completed tool qualification, or
any ASIL-D certification.

The dossier covers analysis functions that could, in a future deployment, be
used to support safety-related engineering decisions (stress analysis,
simulation, controls analysis, and related computation). No such deployment
exists today; all domains are experimental development tools.

## 2. Tool identification

| Attribute                         | Value                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name                      | OmniEng ("engineering-engine")                                                                                                                                                                                                                                                                                                                                    |
| Version                           | 1.0.0 (unreleased, experimental; no tagged release exists)                                                                                                                                                                                                                                                                                                        |
| Repository                        | local git worktree; no configured remote; no hosted CI results                                                                                                                                                                                                                                                                                                    |
| Primary language                  | JavaScript (CommonJS modules), ES2022 target                                                                                                                                                                                                                                                                                                                      |
| Runtime                           | Node.js >= 22.12.0 (package `engines.node`); verification runs on Node 24.16.0                                                                                                                                                                                                                                                                                    |
| Desktop shell                     | Electron 45.1.0 (`electron` devDependency); current macOS minimum 13.0.0. GUI package launch is not verified on the macOS 12.7.6 host.                                                                                                                                                                                                                            |
| Third-party runtime deps          | `three` ^0.186.1 (rendering only); no third-party numerical solver libraries                                                                                                                                                                                                                                                                                      |
| Modules in scope (representative) | `src/core/compliance/asme_section_viii_div2.js`, `src/core/compliance/tool_qualification_kit.js`, `src/core/controls/*`, `src/core/cae/*`, `src/core/robotics/*`, `src/core/math/*`, `src/core/vv/*`, `src/main/ipc/*`; new build-wave modules (Section 6.5) under `src/core/{materials,optics,plant,ai,robotics,fmi,hpc,security,cad,eda,cam,aerospace,archive}` |

## 3. Tool functions

Functions potentially relevant in a functional-safety context:

1. **Stress analysis and screening.** `asme_section_viii_div2.js` provides a
   legacy experimental stress-line screen and a new Part 5-style
   through-thickness linearization module (`linearizeStressThroughThickness`)
   with a Part 5 allowables evaluator (`evaluatePart5Allowables`). Both are
   labeled experimental; outputs are screening aids, not code assessments.
2. **Simulation and control analysis.** FEA, CFD, thermal, controls (EKF,
   PID, Bode analysis), robotics kinematics, optics, plant, model-based
   systems engineering, and HPC modules; all are experimental. The 2026-11-01
   build wave added real materials, optics, thermo/plant, neural-net,
   robotics-collision, FMI, HPC local-scheduler, record-signing, trimmed-NURBS,
   EDA annealing+DRC, CAM 3-axis, shell-assembly, 6-DOF,
   constrained-Delaunay-2D, and streaming-archive capability with passing test
   suites (Section 6.5).
3. **Validation reference harnesses.** `src/core/vv/*` includes manufactured
   solutions (Poisson, sparse SPD, Hertz formula), FEA/analytic cross-checks,
   and NAFEMS/NASA-shaped reference diagnostics.
4. **Tool qualification kit (placeholder).** `tool_qualification_kit.js`
   exposes `evaluateISO26262TCL()` (returns `supported: false`, "not
   implemented") and must not be presented as qualification tooling.

## 4. Operational environment

- Execution: Node.js >= 22.12.0. Verification evidence produced on installed
  Node 24.16.0 (macOS host 12.7.6).
- Desktop: Electron shell; renderer sandboxed with same-origin external
  scripts, blocked inline scripts.
- No hosted CI results in this checkout; declared OS matrix (Ubuntu 22.04/
  24.04, Windows 2025 x64, macOS 15 x64/arm64) is unexecuted here.
- Packaging: local unsigned macOS x64 directory builds succeed; the 2026-10-30
  checkpoint ASAR contains 4,515 entries and excludes `test/`/`scripts/`;
  packaged app not launched on this host (declared macOS 13.0 minimum vs host
  12.7.6); launch smoke was exercised on an earlier Electron build (Section
  6.6).

## 5. Tool classification for functional safety (provisional)

ISO 26262-8:2018 §11.4 defines tool criteria:

- Criterion 1: the tool can produce a faulty output that could lead to the
  violation of a safety goal / safety requirement.
- Criterion 2: the tool could fail to detect an error in the item/its
  design, and that error could lead to violation of a safety goal.
- Criterion 3: the tool could fail to detect an error in a tool used to
  verify an item.

Tool confidence levels (TCL): TCL1 = highest confidence, TCL2 = medium,
TCL3 = lowest. A tool's confidence is established by combining (a) the
severity of criterion impact with (b) the effectiveness of confidence measures
(e.g., deterministic replay, back-to-back testing against an independent
implementation, extensive validation).

For this dossier:

- A **provisional TCL1 target** is recorded for the analysis functions under
  the assumption that they would only be used as development aids with
  independent review, and that confidence measures (Section 6) are completed.
- The target **ASIL-D** context is recorded because the highest-integrity
  road-vehicle functions would be the strictest context. This is a planning
  target; no item, hazard analysis, or safety requirement set exists in this
  repository.
- **The classification is provisional and unconfirmed.** No criterion
  analysis, no TCL determination, and no confidence-measure evaluation have
  been performed or approved.

## 6. Current verification evidence

The figures below were measured on this checkout on Node 24.16.0 (darwin-x64)
on 2026-11-01 late and refreshed 2026-11-02, unless a dated checkpoint is
noted. A passing local check is a diagnostic; it is not a qualified confidence
measure under ISO 26262-8 §11.

### 6.1 Master suite and targeted suites

| Suite                                                      | Contents                                                                                                                                              | Latest recorded result                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node test/run_all_tests.js` (master suite, direct run)    | 871 registered smoke assertions (2026-10-31 direct run); at that checkpoint the V&V runner reported 15 diagnostics (10 pass / 0 unavailable / 5 fail) | **870/871 passed; 1 failed (NASA_TMR_FLAT_PLATE)** — run completed 2026-10-31, exit code 1 solely on the NASA TMR failure (NASA TMR passes in the current runner, 6.3)                                                                    |
| `scripts/run_tests_clean.js` (guarded root runner)         | same master suite plus worktree guard; enforces Node >= 22.12.0                                                                                       | historical checkpoint 2026-10-27: 593/593 passed, 10 validation cases unavailable, 0 failed (pre-V&V-integration state)                                                                                                                   |
| Instrumented integrated run (coverage mode)                | master suite executed under NODE_V8_COVERAGE instrumentation                                                                                          | **1,553/1,556 assertions passed** (2026-11-01 late); 3 recorded failures: claims-language gate (source-comment finding), Hannover genuine reconstruction (f1 −35.92%/f2 −34.77%), PlantEngineAdapter coverage count (11 vs 12 operations) |
| `test/test_asme_viii2_linearization.js`                    | **New (2026-10-28):** Part 5 linearization vs hand-derived values (1e-9 tolerance), allowables acceptance/failing/edge cases, typed-error validation  | 16/16 passed                                                                                                                                                                                                                              |
| `test/test_tier1_commercial_production.js`                 | ASME analyzer contracts, certificate-wording guards                                                                                                   | 6/6 passed (rerun 2026-10-28)                                                                                                                                                                                                             |
| `test/test_gold_benchmarks_3.js`                           | Legacy stress-line screen benchmark; solver gold benchmarks                                                                                           | 30/30 passed (rerun 2026-10-28)                                                                                                                                                                                                           |
| `test/test_coverage_domain_solvers_ipc.js`                 | ASME module artifact; domain solvers & IPC coverage                                                                                                   | 43/43 passed (rerun 2026-10-28)                                                                                                                                                                                                           |
| `test/test_coverage_main_ipc.js`                           | IPC handler coverage including `omni:evaluate-asme-viii-div2`                                                                                         | passed (recorded 2026-10-27)                                                                                                                                                                                                              |
| Controls/robotics/other domain suites                      | e.g., `test/test_robotics_contract.js`, controls/plant/optics/EDA/CAD suites                                                                          | recorded passes in R0 checkpoints; smoke-level                                                                                                                                                                                            |
| `test/test_vv_status_contract.js`; V&V readiness reporting | validation-registry contract                                                                                                                          | see Section 6.3                                                                                                                                                                                                                           |

### 6.2 Static gates

- JavaScript syntax gate `scripts/check_syntax.js`: fresh run 2026-11-02:
  **466/466** JS files parsed, 0 failures.
- ESLint full config: 0 errors (fresh run 2026-11-02; production import
  restrictions; seeded-PRNG rule for tests).
- TypeScript `tsc --pretty false`: 0 errors (fresh run 2026-11-02).
- Prettier review-scope check: clean (fresh run 2026-11-02). The maintained-
  file check (`npm run format:check`) is **FAIL** on 7 branch-gap test files
  (`test/test_coverage_branch_gap{11,22,23,24,25,27,28}.js`); none of the
  four industrialization docs is affected.
- Static IPC registration (`scripts/check_ipc.js`): 180/180 channels, 0
  unmapped (fresh run 2026-11-02); renderer sink inventory
  (`scripts/check_renderer_sinks.js`): 2 docs / 36 first-party scripts /
  16 reviewed `innerHTML` / 1 excluded vendor script.
- Dependency audit `npm audit --audit-level=high`: **0 vulnerabilities** after
  upgrading Electron to 45.1.0 and the minimatch override (local run
  2026-11-01/02). This does not constitute a full security review.
- CycloneDX/SPDX SBOMs were regenerated for lockfile SHA-256
  `360d0c0e6341164eba8756d731ae61eb365985d1101f4da578f02229e0845666`;
  manual license/provenance review remains open.
- Determinism (`scripts/check_determinism.js`): **PASS** — capability matrix
  byte-identical (sha256 `0c8355…`); seeded PRNG replay identical (sha256
  `31c020…`).
- Claims-language gate (`scripts/check_claims_language.js`): **FAIL** (exit 1)
  — one finding at `src/core/cae/shell_assembly.js:16` (gate-banned term in a
  source comment; not in the industrialization docs). Triage pending before the
  gate can count as a confidence measure.
- Poisson budget (`npm run test:poisson-budget`): fresh isolated run
  2026-11-02 passed at **4,493.5 ms** against the configured **10,000 ms**
  budget for 99,856 unknowns, solver and independent relative residuals both
  **9.676775e-12**. Timing is local and not cross-platform evidence.
- Coverage: fresh instrumented run 2026-11-02 measured **4,481/4,955
  functions (90.4%)**, **96,720/99,150 lines (97.5%)**, and a branch-proxy of
  **17,476/20,560 blocks (85.0%)** across 268 production files; all three are
  at or above the configured 85% floors (branch proxy exactly at the floor;
  Section 6.4).

### 6.3 Validation and independence evidence

- The validation diagnostic runner (`npm run test:vv`, `test/vv/run_vv.js`)
  reports **22 listed diagnostics: 21 PASS, 0 UNAVAILABLE, 1 FAIL** (measured
  2026-11-02; verified live on this checkout) and exits 1.
- The sole failing row is `NAFEMS_LE11`: measured σ_z(A) = **+9.13 MPa** vs
  −105 MPa reference → **108.7% deviation** (beyond ±5%) under the documented
  both-ends axial restraint set (nodal-extrapolated corner value;
  element-averaged σ_z(A) = −109.7 MPa on the base mesh). The failure is
  recorded and fail-closed; no canned value replaces it.
- `NASA_TMR_FLAT_PLATE` now **PASSES** (Cf error **0.6886%** vs 4%
  tolerance; stationarity passes: wall-Cf range 0.0868%, profile drift
  0.0925% over 20 steps against 1% limits; finite after 1,800 steps). This
  supersedes the prior failing states (94.4% and 28.3% Cf deviations).
- The passing diagnostics are analytic, discrete numerical, manufactured,
  generated, cross-solver, or NAFEMS/ISO-style reference checks: NAFEMS LE1/
  LE10/FV32/T1 (PASS), ISO 10110 singlet surface form, Hertz closed-form pair,
  Poisson MMS (order 2.0494/2.0236), manufactured sparse SPD, generated sparse
  SPD suite, Lamé cylinder closed form vs production HEX20 FEA, elasticity
  patch test, Euler–Bernoulli beam frequencies, fully constrained thermal
  stress, MMS elasticity body-force, spring-mass-damper ODE, Timoshenko/
  Euler cantilever MOOSE cross-checks, cantilever first modal frequency, and
  the shell plate deflection (Kirchhoff vs MITC4). They are **not** runs of
  the named NIST, Hannover, or original discrete-Hertz reference cases and are
  not qualified confidence measures under ISO 26262-8 §11.
- Deterministic test inputs: fixed-seed PRNG fixtures; same-seed replay
  checks pass (parser suite, capability matrix). Not tied to any safety-
  function tool use.

### 6.4 Coverage

- V8 loaded-source coverage (instrumented run completed 2026-11-02):
  **4,481 / 4,955 functions (90.4%)** and **96,720 / 99,150 lines (97.5%)**
  with a branch-proxy of **17,476 / 20,560 non-entry blocks (85.0%)** across
  **268 production files**; all three at or above the configured 85% floors
  (branch proxy at the floor).
- Previous measured states are superseded: 97.5%/96.9%/68.9% across 238 files
  (2026-10-31); 89.5%/88.7%/77.3% across 260 files (2026-11-01 late);
  95.1%/93.9%/78.1% across 244 files (2026-11-01 evening).
- Coverage measures function entries and executable lines of loaded source only
  (module-initialization ranges excluded). The branch metric is a V8
  block-transition proxy (non-entry ranges treated as branch-target blocks),
  not MC/DC, and coverage does not by itself satisfy ISO 26262 verification
  objectives.

### 6.5 Build-wave evidence (2026-11-01)

| Module family       | Test suite                                                   | Recorded result                                                                                                                                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Materials           | `test_materials_catalog.js`                                  | 11 documented-typical cards (MIL-HDBK-5J, ASTM A516/A106/A240, INCONEL 718 datasheet) replacing the former empty catalog; provenance URL + SI units + finite numeric props; interpolation monotonic; FEA materialId solve works; fail-closed on unknown/malformed input                                                                                                    |
| Optics              | `test_optical_glass_catalog.js`                              | Real 41-glass catalog (SCHOTT/OHARA/Crystran datasheets); N-BK7 n_d 1.5168 matches published value within 1e-4, Abbe 64.17 within 1%; adapter lookup/trace end-to-end; unknown glass fail-closed                                                                                                                                                                           |
| Thermo/plant        | `test_thermo_compounds.js`, `test_plant_column_mesh.js`      | 20-species correlation engine (Clausius–Clapeyron, Watson latent heat, NIST-JANAF Cp within 1% at 298.15 K, Rackett liquid density; explicitly **not** a DIPPR 801 data product). Distillation column: benzene/toluene xD = 0.9196 / xB = 0.0804 matches independent tray-by-tray implementation (\|Δ\| < 0.05); monotonic temperature profile; deterministic; fail-closed |
| Neural net          | `test_neural_net.js`                                         | Real MLP (train/predict/gradient-check); held-out R² = 0.9440 on 200 unseen samples; gradient check maxAbsDiff 2.29e-11; IPC routes registered and fail-closed; 25/25                                                                                                                                                                                                      |
| Robotics collision  | `test_robotics_collision.js`                                 | Mesh collision route (AABB broadphase + Möller–Trumbore triangle intersection) 6/6                                                                                                                                                                                                                                                                                         |
| FMI                 | `test_fmu_reader.js`                                         | Real FMI 2.0 package reader (zip+XML modelDescription) and in-JS host; rk45 matches analytic at t=10 within 1%; malformed zip/XML raise typed `FmuError`; native dlopen unavailable                                                                                                                                                                                        |
| HPC local scheduler | `test_hpc_local_scheduler.js`                                | Real multi-process scheduler executing production sparse solves (residual 8.567e-9 < 1e-8); timeout/cancellation fail-closed; 71/71. Remote Slurm/PBS still unavailable (`submitted: false` templates)                                                                                                                                                                     |
| Signing chain       | `test_record_signing.js`                                     | ECDSA P-384 / RSA-4096 (SHA-384) signed record chain with software keystore; canonicalization invariant; tamper/reorder/removal rejection; supervisor signs TOOL_STARTED/TOOL_RESULT; 13/13. Hardware HSM unavailable                                                                                                                                                      |
| Trimmed NURBS       | `test_nurbs_trimmed_surface.js`                              | Trimmed NURBS surfaces with 2D NURBS trim loops; STEP AP214 trim-curve export round-trips; tessellation area rel err 0.686%; SSI fallback retained; 5/5                                                                                                                                                                                                                    |
| EDA annealing + DRC | `test_eda_placement_annealing.js`, `test_eda_polygon_drc.js` | Simulated-annealing placement: mean HPWL 1634 → 955 µm (−41.6%) over 5 seeds; final layout DRC clean (0 violations); per-seed deterministic. Polygon DRC: all-angle width/spacing/validity, self-intersection rejection, enclosure; byte-identical repeat runs; adapter end-to-end                                                                                         |
| CAM 3-axis          | `test_cam_3axis_toolpath.js`                                 | 3-axis contour-parallel roughing (5 contours/layer × 5 Z layers) + finish passes + G2/G3 arcs (441 motion lines, 145 arcs, 60 finish-feed lines); engagement policy max stepover 4 mm; telemetry 8,653.7 mm path, ~8.7 min, MRR 8,966 mm³/min; legacy 2.5D retained                                                                                                        |
| Shell assembly      | `test_shell_assembly.js`                                     | MITC4 shell assembly 12/12 (mesh convergence, Kirchhoff center deflection within 3%, fail-closed) plus the passing `SHELL_SS_SQUARE_PLATE_DEFLECTION` V&V row                                                                                                                                                                                                              |
| 6-DOF               | `test_aerospace_six_dof.js`                                  | Real 6-DOF flight dynamics: apogee at t = 10.1972 s (analytic exact), impact at t = 4.5160 s / 44.29 m/s; quaternion norm drift 3.55e-15 over 10,000 RK4 steps; deterministic; adapter end-to-end                                                                                                                                                                          |
| CDT2D               | `test_delaunay_constrained_2d.js`                            | Constrained Delaunay 2D mesher (polygon with hole) wired to Poisson TRI3 elements; linear manufactured field reproduced exactly at a probe (FEM = exact = 1.557326905); quadratic manufactured field converges; 13/13                                                                                                                                                      |
| Streaming archive   | `test_omni_archive_streaming.js`                             | Streaming archive v3: 256 MiB synthetic entry written as 256 × 1 MiB chunks (write 12,378 ms; ~1.13 MiB on disk), streamed read with peak RSS Δ 28.3 MiB; 256 chunk SHA-256s + whole-entry SHA-256 verified; corruption detection; byte parity with the legacy in-memory API                                                                                               |

### 6.6 Behavioral honesty notes

- `ToolQualificationKit.evaluateISO26262TCL()` returns `supported: false`,
  "ISO 26262 tool confidence assessment is not implemented."
- Stress results are labeled `screening-only` / `caller-supplied-unverified`;
  no certificate documents are emitted.
- The prior Electron 34 / `extract-zip` findings are superseded by Electron
  45.1.0 and a current `npm audit` result of 0 vulnerabilities. Hosted security
  scanning and a broader security review remain outstanding.

### 6.7 Requirements ↔ evidence traceability matrices (bidirectional)

The matrices below are the internal, evidence-based traceability map for the
R0 release train, enforced against `docs/industrialization/requirements_traceability.md`
by `scripts/check_requirements_coverage.js` (40 requirements parsed, 37
IMPLEMENTED, 0 missing artifacts, gate PASS on 2026-11-02). This is an
engineering traceability record; it is **not** a safety-managed traceability
scheme, a review record, or a qualified confidence measure under ISO 26262-8
§11.

#### 6.7.1 Matrix A — Requirements → evidence

Rows = the 40 R0 requirements; columns = verification evidence classes (V&V
diagnostics, test suites, automated/static gates and documentation, production
code modules). Empty cells are marked `—`; a requirement is _mapped_ when at
least one evidence cell is non-empty. A `GAP` status means no local evidence
exists.

| REQ-ID  | V&V diagnostics                                                                                                                                                                                                                                                                                                                           | Test suites                                                                        | Gates / documentation                                                                           | Code modules                                                                                              | Status / gap                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REQ-001 | readiness flags false; `test_vv_status_contract.js`                                                                                                                                                                                                                                                                                       | `test/test_vv_status_contract.js`                                                  | `docs/industrialization/vv_report.md`                                                           | `src/core/vv/validation_readiness.js`                                                                     | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-002 | `NAFEMS_LE11` (FAIL recorded), `NASA_TMR_FLAT_PLATE` (PASS)                                                                                                                                                                                                                                                                               | `test/test_vv_status_contract.js`                                                  | `scripts/generate_vv_report.js`; exit 1 on failure                                              | `src/core/vv/validation_readiness.js`                                                                     | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-003 | `NAFEMS_LE1`, `NAFEMS_LE10`, `NAFEMS_FV32`, `NAFEMS_T1`, `NAFEMS_LE11`, `NASA_TMR_FLAT_PLATE`, `ISO10110_SINGLET_SURFACE_FORM`, MOOSE pair                                                                                                                                                                                                | `test/test_vv_status_contract.js`                                                  | `docs/industrialization/reference_registry.md`                                                  | `src/core/vv/benchmark_runners.js`                                                                        | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-004 | `POISSON_2D_SINE_MMS`, `MANUFACTURED_SPARSE_SPD`, `SPARSE_SPD_GENERATED_SUITE`, `LAME_CYLINDER_INTERNAL_PRESSURE`, `ELASTICITY_PATCH_HEX20`, `BEAM_EULER_BERNOULLI_SS_FREQUENCIES`, `THERMAL_STRESS_FULLY_CONSTRAINED_CYLINDER`, `MMS_ELASTICITY_HEX20_BODYFORCE`, `ODE_SPRING_MASS_DAMPER_TRANSIENT`, `SHELL_SS_SQUARE_PLATE_DEFLECTION` | `test/vv/run_vv.js`                                                                | `docs/industrialization/vv-diagnostic-report.md`                                                | `src/core/math/poisson_2d_direct.js`                                                                      | mapped — IMPLEMENTED; note: the dedicated Kirsch analytic row was superseded by the FEA/analytic diagnostic family; the manufactured/analytic set still runs |
| REQ-005 | —                                                                                                                                                                                                                                                                                                                                         | FVM typed-error coverage tests                                                     | `docs/industrialization/fvm_hardening_report.md`                                                | `src/core/cae/fvm_navier_stokes_3d.js`                                                                    | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-006 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_fvm_turbulence_stability.js` (6/6)                                      | `docs/industrialization/fvm_hardening_report.md`                                                | `src/core/cae/fvm_navier_stokes_3d.js`                                                                    | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-007 | `POISSON_2D_SINE_MMS` (order 2.0494/2.0236)                                                                                                                                                                                                                                                                                               | `test/test_mms_grid_convergence.js`                                                | gate runs inside root suite                                                                     | `src/core/math/poisson_2d_direct.js`                                                                      | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-008 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_coverage_core_solvers.js`                                               | —                                                                                               | solvers under `src/core/math/*`, `src/core/cae/*`                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-009 | —                                                                                                                                                                                                                                                                                                                                         | `test/run_all_tests.js`; `scripts/run_tests_clean.js` guard                        | master suite results (Section 6.1)                                                              | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-010 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_coverage_remaining_modules.js` (17/17)                                  | coverage gates (Section 6.4)                                                                    | previously unreferenced modules                                                                           | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-011 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_mms_grid_convergence.js` inside root suite                              | gate run                                                                                        | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-012 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | syntax 466/466; ESLint 0; tsc 0; IPC 180/180; sink inventory clean; Prettier review-scope clean | `scripts/check_syntax.js`, `scripts/check_ipc.js`, `scripts/check_renderer_sinks.js`, `eslint.config.mjs` | mapped — IMPLEMENTED (note: maintained-Prettier open items on 7 test files, Section 6.2)                                                                     |
| REQ-013 | —                                                                                                                                                                                                                                                                                                                                         | sender-guard assertions in master suite                                            | —                                                                                               | `src/main/ipc/define_handler.js`, `src/core/security/ipc_validator.js`                                    | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-014 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `npm audit` 0 vulnerabilities; SBOM regenerated                                                 | `docs/sbom/omnieng-dependencies.cdx.json`, `docs/third_party_notices.md`                                  | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-015 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/security/threat_model.md`                                                                 | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-016 | —                                                                                                                                                                                                                                                                                                                                         | determinism check PASS                                                             | secret-pattern scan; ESLint PRNG rule; `git diff --check`                                       | `eslint.config.mjs`                                                                                       | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-017 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/packaging_report.md`                                                    | `electron-builder.yml`                                                                                    | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-018 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | packaging checkpoint: unpacked build exit 0; ASAR byte-match                                    | packaging artifacts                                                                                       | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-019 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | recorded launch evidence on earlier Electron build (43.8.6 `--test-ui`, exit 0, macOS 12.7.6)   | packaged app                                                                                              | mapped — IMPLEMENTED with caveat: current Electron 45.1.0 package built but not launched on this host (macOS 13 minimum vs host 12.7.6)                      |
| REQ-020 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | —                                                                                               | —                                                                                                         | **GAP** — EXTERNAL-BLOCKED (Apple Developer ID / notarization infrastructure absent)                                                                         |
| REQ-021 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | this dossier                                                                                    | `docs/industrialization/certification/do330_tql_dossier.md`                                               | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-022 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/certification/iso26262_safety_case.md`                                  | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-023 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/certification/evidence_ledger.md`; `certificationClaimed: false`        | `src/core/compliance/tool_qualification_kit.js`                                                           | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-024 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | —                                                                                               | —                                                                                                         | **GAP** — EXTERNAL-BLOCKED (accredited conformity assessment infrastructure absent)                                                                          |
| REQ-025 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_shared_contracts.js`                                                    | —                                                                                               | `src/core/contracts/JobRequest.js`, `src/core/contracts/engine_registry.js`                               | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-026 | `SHELL_SS_SQUARE_PLATE_DEFLECTION` (explicit-input shell route)                                                                                                                                                                                                                                                                           | adapter coverage suites                                                            | `docs/industrialization/anti_facade_remediation.md`                                             | build-wave adapters (materials/optics/plant/robotics/EDA/CAM/aerospace/FMI/HPC)                           | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-027 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `scripts/generate_capability_matrix.js`; matrix deterministic                                   | `docs/industrialization/capability_matrix.md`                                                             | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-028 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_preload_compatibility.js`                                               | IPC registration 180/180, 0 duplicates                                                          | preload surface                                                                                           | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-029 | current runner state                                                                                                                                                                                                                                                                                                                      | —                                                                                  | `docs/industrialization/status.md`, `docs/known_limitations.md`                                 | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-030 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/mercury_inception/ENGINEERING_PROTOCOL.md`, `SETUP_VERIFICATION.md`     | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-031 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_requirements_coverage.js`                                               | `scripts/check_requirements_coverage.js` PASS (40/37/0)                                         | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-032 | —                                                                                                                                                                                                                                                                                                                                         | maturity-registry assertions in master suite                                       | `docs/industrialization/readiness_scorecard.md`                                                 | `src/core/maturity/feature_maturity.js`                                                                   | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-033 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | Poisson budget PASS (4,493.5 ms / 10,000 ms; residual 9.676775e-12)                             | `scripts/run_poisson_budget.js`, `src/core/vv/poisson_performance.js`                                     | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-034 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/performance_report.md`                                                  | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-035 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `.github/workflows/ci.yml` (config only; no hosted results; no remote)                          | —                                                                                                         | **GAP** — EXTERNAL-BLOCKED                                                                                                                                   |
| REQ-036 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_worker_pool_concurrency.js`; `test/test_hpc_local_scheduler.js` (71/71) | —                                                                                               | `src/core/hpc/*`                                                                                          | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-037 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `package.json` (`engines.node` >= 22.12.0; pinned)                                              | `package.json`                                                                                            | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-038 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/third_party_notices.md` regenerated with SBOM                                             | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-039 | reference provenance rows                                                                                                                                                                                                                                                                                                                 | —                                                                                  | `docs/data_provenance.md`, `docs/industrialization/reference_registry.md`                       | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                         |
| REQ-040 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | launch evidence recorded in `docs/industrialization/status.md`                                  | packaged runtime                                                                                          | mapped — IMPLEMENTED with caveat: update/rollback evidence remains external                                                                                  |

**Counts:** 40 requirements listed; **37 mapped to evidence** (IMPLEMENTED),
**3 gaps** (REQ-020, REQ-024, REQ-035 — all EXTERNAL-BLOCKED, no local
evidence). Informational caveats: REQ-004 (dedicated Kirsch row superseded by
the FEA/analytic family), REQ-019 and REQ-040 (launch evidence on an earlier
Electron build).

#### 6.7.2 Matrix B — Evidence → requirements

Rows = verification evidence items; column = supported requirement IDs. Only
requirement-bearing evidence is listed; generic evidence (e.g., Prettier) is
not mapped to an R0 requirement.

| Evidence item                                                                                                                                                                                                                                                                                                                  | Supports REQ-IDs                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| V&V `NAFEMS_LE1`, `NAFEMS_LE10`, `NAFEMS_FV32`, `NAFEMS_T1`                                                                                                                                                                                                                                                                    | REQ-003                                           |
| V&V `NAFEMS_LE11` (FAIL)                                                                                                                                                                                                                                                                                                       | REQ-002, REQ-003                                  |
| V&V `NASA_TMR_FLAT_PLATE`                                                                                                                                                                                                                                                                                                      | REQ-002, REQ-003                                  |
| V&V `ISO10110_SINGLET_SURFACE_FORM`                                                                                                                                                                                                                                                                                            | REQ-003                                           |
| V&V MOOSE Timoshenko/Euler pair                                                                                                                                                                                                                                                                                                | REQ-003                                           |
| V&V `POISSON_2D_SINE_MMS`                                                                                                                                                                                                                                                                                                      | REQ-004, REQ-007                                  |
| V&V `MANUFACTURED_SPARSE_SPD`, `SPARSE_SPD_GENERATED_SUITE`                                                                                                                                                                                                                                                                    | REQ-004                                           |
| V&V `LAME_CYLINDER_INTERNAL_PRESSURE`, `ELASTICITY_PATCH_HEX20`, `BEAM_EULER_BERNOULLI_SS_FREQUENCIES`, `THERMAL_STRESS_FULLY_CONSTRAINED_CYLINDER`, `MMS_ELASTICITY_HEX20_BODYFORCE`, `ODE_SPRING_MASS_DAMPER_TRANSIENT`, `CANTILEVER_FIRST_MODAL_ANALYTIC`, `HERTZ_ANALYTICAL_FORMULA`, `HERTZ_CONTACT_CLOSED_FORM_ANALYTIC` | REQ-004                                           |
| V&V `SHELL_SS_SQUARE_PLATE_DEFLECTION`                                                                                                                                                                                                                                                                                         | REQ-004, REQ-026                                  |
| `test/vv/run_vv.js`                                                                                                                                                                                                                                                                                                            | REQ-004                                           |
| `test/test_vv_status_contract.js`, `src/core/vv/validation_readiness.js`                                                                                                                                                                                                                                                       | REQ-001, REQ-002                                  |
| `scripts/generate_vv_report.js`, `docs/industrialization/vv_report.md`                                                                                                                                                                                                                                                         | REQ-002                                           |
| `docs/industrialization/reference_registry.md`                                                                                                                                                                                                                                                                                 | REQ-003, REQ-039                                  |
| `test/test_mms_grid_convergence.js`                                                                                                                                                                                                                                                                                            | REQ-007, REQ-011                                  |
| `test/test_fvm_turbulence_stability.js`                                                                                                                                                                                                                                                                                        | REQ-006                                           |
| `src/core/cae/fvm_navier_stokes_3d.js`                                                                                                                                                                                                                                                                                         | REQ-005, REQ-006                                  |
| `test/test_coverage_core_solvers.js`                                                                                                                                                                                                                                                                                           | REQ-008                                           |
| `test/test_coverage_remaining_modules.js`                                                                                                                                                                                                                                                                                      | REQ-010                                           |
| `test/run_all_tests.js`, `scripts/run_tests_clean.js`                                                                                                                                                                                                                                                                          | REQ-009, REQ-013, REQ-032                         |
| `scripts/check_syntax.js` (466/466), `eslint.config.mjs`, `tsc`                                                                                                                                                                                                                                                                | REQ-012                                           |
| `scripts/check_ipc.js` (180/180), `scripts/check_renderer_sinks.js`, `test/test_preload_compatibility.js`                                                                                                                                                                                                                      | REQ-012, REQ-028                                  |
| `npm audit` 0, `docs/sbom/omnieng-dependencies.cdx.json`, `docs/third_party_notices.md`                                                                                                                                                                                                                                        | REQ-014, REQ-038                                  |
| `docs/security/threat_model.md`                                                                                                                                                                                                                                                                                                | REQ-015                                           |
| `scripts/check_determinism.js`, `scripts/check_secret_patterns.js`                                                                                                                                                                                                                                                             | REQ-016                                           |
| `electron-builder.yml`, `docs/industrialization/packaging_report.md`                                                                                                                                                                                                                                                           | REQ-017, REQ-018, REQ-019, REQ-040                |
| `docs/industrialization/certification/do330_tql_dossier.md`, `iso26262_safety_case.md`, `evidence_ledger.md`                                                                                                                                                                                                                   | REQ-021, REQ-022, REQ-023                         |
| `src/core/contracts/JobRequest.js`, `src/core/contracts/engine_registry.js`, `test/test_shared_contracts.js`                                                                                                                                                                                                                   | REQ-025                                           |
| `docs/industrialization/anti_facade_remediation.md`; build-wave adapter suites (materials/optics/plant/robotics/EDA/CAM/aerospace/FMI/HPC)                                                                                                                                                                                     | REQ-026                                           |
| `scripts/generate_capability_matrix.js`, `docs/industrialization/capability_matrix.md`                                                                                                                                                                                                                                         | REQ-027                                           |
| `docs/industrialization/status.md`, `docs/known_limitations.md`                                                                                                                                                                                                                                                                | REQ-029                                           |
| `docs/industrialization/mercury_inception/ENGINEERING_PROTOCOL.md`, `SETUP_VERIFICATION.md`                                                                                                                                                                                                                                    | REQ-030                                           |
| `scripts/check_requirements_coverage.js`, `test/test_requirements_coverage.js`                                                                                                                                                                                                                                                 | REQ-031                                           |
| `src/core/maturity/feature_maturity.js`                                                                                                                                                                                                                                                                                        | REQ-032                                           |
| `scripts/run_poisson_budget.js`, `src/core/vv/poisson_performance.js`, `docs/industrialization/performance_report.md`                                                                                                                                                                                                          | REQ-033, REQ-034                                  |
| `test/test_worker_pool_concurrency.js`, `test/test_hpc_local_scheduler.js`                                                                                                                                                                                                                                                     | REQ-036                                           |
| `package.json`                                                                                                                                                                                                                                                                                                                 | REQ-037                                           |
| `docs/data_provenance.md`                                                                                                                                                                                                                                                                                                      | REQ-039                                           |
| `.github/workflows/ci.yml`                                                                                                                                                                                                                                                                                                     | REQ-035 (configured; no hosted results — **GAP**) |
| `docs/industrialization/certification/evidence_ledger.md` (independent conformity assessment)                                                                                                                                                                                                                                  | REQ-024 (**GAP**)                                 |
| macOS signing/notarization infrastructure                                                                                                                                                                                                                                                                                      | REQ-020 (**GAP**)                                 |

## 7. Gaps against ISO 26262 (§8 Part 11 / safety case)

1. **No item or hazard analysis.** No item definition, HARA, functional
   safety concept, or safety goal exists; ASIL-D context cannot be anchored.
2. **No tool criterion analysis.** ISO 26262-8 §11.4 criteria 1–3 have not
   been evaluated for any tool function; no TCL is determined.
3. **No confidence measures evaluated.** None of the measures in ISO 26262-8
   Table 12 (e.g., back-to-back testing with an independent tool/implementation,
   deterministic input/output replay, extensive tool validation, error
   detection in the tool) have been established as qualification evidence.
4. **No safety manual / safety case structure.** No safety case argument
   (claims, arguments, evidence) exists; this dossier is a precursor.
5. **No functional safety management.** No safety manager, competence
   records, or development-interface agreements exist.
6. **No independent assessment.** No independent safety assessor has
   reviewed any evidence.
7. **Environment untested in target conditions.** No hosted CI results; no
   Windows/Linux execution records; no packaged-app launch for the current
   build (REQ-019/REQ-035/REQ-040 gaps).
8. **No configuration management for safety.** No release baseline, change
   control, or problem-report process in a safety-managed sense.
9. **Traceability is internal, not safety-managed.** The bidirectional
   requirement → evidence matrices in Section 6.7 exist and are gate-enforced
   (40/37/0), but there are no review records, the test authorship is not
   independent, and the matrices are not linked to a safety requirements set.
10. **No deployment/usage restrictions defined.** No documented
    preconditions, user skill requirements, or review gates for safety-
    relevant use.
11. **Unresolved verification findings.** `NAFEMS_LE11` fails (108.7%
    nodal-extrapolated deviation); the claims-language gate FAILs on one
    source-comment finding; the maintained-Prettier check FAILs on 7 branch-
    gap test files; the Hannover genuine reconstruction (f1/f2) and
    PlantEngineAdapter coverage-count failures are recorded in the instrumented
    integrated run; the branch-coverage proxy sits exactly at the 85% floor.

## 8. NOT YET CERTIFIED statement

**The Tool is NOT YET CERTIFIED or qualified under ISO 26262.** No TCL has
been determined, no safety case has been accepted, no ASIL-D (or any ASIL)
related approval exists, and the Tool is not authorized for use in
safety-related automotive development on the basis of current evidence. The
provisional TCL1/ASIL-D target in this dossier is a planning artifact only.
The in-repo "tool qualification kit" explicitly reports that ISO 26262 tool
confidence assessment is not implemented. The traceability matrices in
Section 6.7 and all measured gate results are evidence records, not
qualification measures.

## 9. Roadmap

1. Define an item and perform hazard analysis to establish whether any
   OmniEng function is safety-related and at what ASIL; document the
   resulting scope (or confirm the Tool is excluded from safety-related use).
2. Perform the ISO 26262-8 §11.4 criterion analysis for each candidate tool
   function and record the impact severity and required confidence measures.
3. Select and implement confidence measures (priority: deterministic replay
   with recorded inputs/outputs, and back-to-back comparison against an
   independent numerical implementation for solvers, the linearization
   module, and the build-wave numerical modules).
4. Introduce a safety-managed change-control and problem-report process, and
   release baselines with signed tags and SBOMs.
5. Execute targeted suites on the declared OS matrix with hosted results and
   record them in this dossier (REQ-035).
6. Triage or remediate the open verification findings in Section 7 item 11
   (LE11 diagnostic, claims-language comment, maintained-Prettier files,
   Hannover reconstruction, adapter coverage count).
7. Engage an independent functional-safety assessor to review evidence and
   the resulting safety case argument.
8. Produce a safety case (claims–argument–evidence) and a tool usage manual
   with preconditions, limitations, and review gates — and only then submit
   it for organizational/authority consideration.

---

_End of dossier. Prepared as an honest evidence record; it deliberately claims
no certification._
