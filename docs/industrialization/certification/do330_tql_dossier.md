# DO-330 Tool Qualification Evidence Dossier — OmniEng Engineering Tool Suite

| Field                      | Value                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| Document ID                | OMN-IND-CERT-DO330-001                                                   |
| Version                    | 0.3.0 (draft)                                                            |
| Date                       | 2026-11-02                                                               |
| Document class             | Working evidence dossier — **not** a tool qualification certificate      |
| Target qualification level | TQL-5 (provisional classification, not granted)                          |
| Applicable standard        | RTCA DO-330 / EUROCAE ED-215, Software Tool Qualification Considerations |
| Status                     | **NOT YET CERTIFIED**                                                    |

## 1. Purpose and scope

This dossier records the current state of evidence for qualifying the OmniEng
engineering tool suite ("the Tool") under RTCA DO-330. It is an internal
industrialization artifact for the R0 credibility/reproducibility release
train. It does **not** grant, claim, or imply a DO-330 qualification, a DO-178C
airworthiness approval, or any certification-authorized tool credit.

The dossier covers the software elements of the Tool that perform engineering
calculation, analysis, and result-rendering functions. It does not cover the
Electron application shell, packaging, or deployment infrastructure beyond what
is needed to describe the operational environment.

All domains remain **experimental** and are not release-approved.

## 2. Tool identification

| Attribute                         | Value                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name                      | OmniEng ("engineering-engine")                                                                                                                                                                                                                                                                                      |
| Version                           | 1.0.0 (unreleased, experimental; no tagged release exists)                                                                                                                                                                                                                                                          |
| Repository                        | local git worktree; **no configured remote**; no hosted CI results                                                                                                                                                                                                                                                  |
| Primary language                  | JavaScript (CommonJS modules), ES2022 target                                                                                                                                                                                                                                                                        |
| Runtime                           | Node.js >= 22.12.0 (package `engines.node`); verification runs on Node 24.16.0                                                                                                                                                                                                                                      |
| Desktop shell                     | Electron 45.1.0 (`electron` devDependency); current macOS minimum 13.0.0. GUI package launch is not verified on the macOS 12.7.6 host.                                                                                                                                                                              |
| Third-party runtime deps          | `three` ^0.186.1 (rendering only); no third-party numerical solver libraries                                                                                                                                                                                                                                        |
| OS targets (declared)             | Ubuntu 22.04/24.04, Windows 2025 x64, macOS 15 x64/arm64; packaged app minimum macOS 13.0                                                                                                                                                                                                                           |
| Modules in scope (representative) | `src/core/compliance/asme_section_viii_div2.js`, `src/core/compliance/tool_qualification_kit.js`, `src/core/cae/*`, `src/core/math/*`, `src/core/vv/*`, `src/main/ipc/*`; new build-wave modules (Section 6.5) under `src/core/{materials,optics,plant,ai,robotics,fmi,hpc,security,cad,eda,cam,aerospace,archive}` |

## 3. Tool functions

The Tool is an interactive engineering workbench. Functions relevant to this
dossier:

1. **Stress analysis and screening.** `asme_section_viii_div2.js` provides:
   - a legacy, experimental through-thickness stress-line screen
     (`linearizeStressClassificationLine`), which performs trapezoidal
     integration of a single scalar stress component against a caller-supplied
     limit; it explicitly reports `screening-only` status and does not perform
     a code assessment;
   - a Part 5-style through-thickness stress linearization module
     (`linearizeStressThroughThickness`), implementing least-squares linear
     regression per tensor component against membrane, bending, and local
     (nonlinear residual) components; and
   - a Part 5 allowables evaluator (`evaluatePart5Allowables`) applying the
     classic thresholds Pm <= S, Pm + Pb <= 1.5·S, and (when supplied)
     Pm + Pb + Q <= 3·S, with an explicit out-of-scope notice for the
     local/peak component, which Part 5 refers to fatigue assessment.
2. **Simulation and solve engines.** FEA, CFD, thermal, mechanics, controls,
   optics, plant, robotics, CAD, EDA, aerospace, and HPC modules under
   `src/core/*`; all are declared experimental. The 2026-11-01 build wave added
   real materials, optics, thermo/plant, neural-net, robotics-collision, FMI,
   HPC local-scheduler, record-signing, trimmed-NURBS, EDA annealing+DRC, CAM
   3-axis, shell-assembly, 6-DOF, constrained-Delaunay-2D, and streaming-archive
   capability with passing test suites (Section 6.5).
3. **Validation reference harnesses.** `src/core/vv/*` implements manufactured
   solutions, FEA/analytic cross-checks, and NAFEMS/NASA-shaped reference
   diagnostics (see Section 6.3).
4. **Tool qualification kit (placeholder).** `tool_qualification_kit.js`
   exposes `evaluateDO330TQL()` (returns `supported: false`, "not
   implemented") and must not be presented as qualification tooling.

## 4. Operational environment

- Execution: Node.js >= 22.12.0. Verification evidence in this dossier was
  produced on installed Node 24.16.0 (macOS host 12.7.6).
- Desktop: Electron shell; renderer is sandboxed with same-origin external
  scripts and blocked inline scripts.
- The package declares no hosted CI results; the configured five-runner matrix
  has not produced hosted output in this checkout.
- Packaging: local unsigned macOS x64 directory builds (`electron-builder
--dir`) succeed; the 2026-10-30 checkpoint ASAR contains 4,515 entries and
  excludes `test/` and `scripts/`. The packaged app has **not** been launched
  on this host (declared macOS 13.0 minimum vs host 12.7.6); a launch smoke was
  exercised on an earlier Electron build (Section 6.6).

## 5. Tool classification (provisional)

DO-330 classifies tools by criteria (Section 1.4, Table 1-1):

- Criterion 1: the tool could insert an error into a verified artifact that
  could remain undetected.
- Criterion 2: the tool could fail to detect an error in a verified artifact.
- Criterion 3: the tool could reduce the level of verification of a verified
  artifact.

For the current analysis/screening functions, a provisional classification is
recorded but **not** finalized:

- Tool outputs are numerical stress classifications used during development
  review; they are screened against caller-supplied allowables and are labeled
  experimental. The Tool is not used as an approved verification/elimination
  tool in any aircraft development program.
- A provisional **TQL-5** target is recorded (lowest rigor level, appropriate
  for development tools whose malfunction can be contained by review and where
  the tool is not relied on for certification credit).
- The classification is provisional because the Criteria analysis has not been
  performed against a concrete program, tool-chain, and verification process.
  TQL-5 is a **target**, not a granted level.

## 6. Current verification evidence

The figures below were measured on this checkout on Node 24.16.0 (darwin-x64)
on 2026-11-01 late and refreshed 2026-11-02, unless a dated checkpoint is
noted. A passing local check is a diagnostic; it is not a qualified confidence
measure under DO-330 and none of these checks, individually or combined,
constitute certification evidence.

### 6.1 Master suite and targeted suites

| Suite                                                         | Coverage/contents                                                                                                                                                                              | Latest recorded result                                                                                                                                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node test/run_all_tests.js` (master suite, direct run)       | 871 registered smoke assertions (2026-10-31 direct run); at that checkpoint the V&V runner reported 15 diagnostics (10 pass / 0 unavailable / 5 fail)                                          | **870/871 passed; 1 failed (NASA_TMR_FLAT_PLATE)** — run completed 2026-10-31, exit 1 solely on the NASA TMR failure (NASA TMR passes in the current runner, 6.3)                                                                         |
| `scripts/run_tests_clean.js` (guarded root runner)            | same master suite plus worktree-change guard; enforces installed Node >= 22.12.0                                                                                                               | historical checkpoint 2026-10-27: 593/593 passed, 10 validation cases unavailable, 0 failed (pre-V&V-integration state)                                                                                                                   |
| Instrumented integrated run (coverage mode)                   | master suite executed under NODE_V8_COVERAGE instrumentation                                                                                                                                   | **1,553/1,556 assertions passed** (2026-11-01 late); 3 recorded failures: claims-language gate (source-comment finding), Hannover genuine reconstruction (f1 −35.92%/f2 −34.77%), PlantEngineAdapter coverage count (11 vs 12 operations) |
| `test/test_tier1_commercial_production.js`                    | ASME analyzer constructor validation, legacy stress-line screen contract, secondary-thermal rejection, certificate wording ("not an ASME BPVC report")                                         | 6/6 passed (targeted rerun 2026-10-28; also executed inside the master suite)                                                                                                                                                             |
| `test/test_gold_benchmarks_3.js`                              | Benchmark 25 exercises legacy `linearizeStressClassificationLine` vs supplied limits                                                                                                           | 30/30 passed (targeted rerun 2026-10-28)                                                                                                                                                                                                  |
| `test/test_coverage_domain_solvers_ipc.js`                    | ASME module certifier/document-generator contract; solvers & IPC coverage                                                                                                                      | 43/43 passed (targeted rerun 2026-10-28)                                                                                                                                                                                                  |
| `test/test_coverage_main_ipc.js`                              | IPC handler `omni:evaluate-asme-viii-div2` end-to-end                                                                                                                                          | passed (recorded 2026-10-27 run)                                                                                                                                                                                                          |
| `test/test_asme_viii2_linearization.js`                       | **New (2026-10-28):** Part 5 least-squares linearization against hand-derived membrane/bending/local values (tolerance 1e-9), allowables acceptance/edge/failing cases, typed-error validation | 16/16 passed (targeted run 2026-10-28)                                                                                                                                                                                                    |
| `test/test_vv_status_contract.js` and V&V readiness reporting | Validation-registry contract                                                                                                                                                                   | see Section 6.3                                                                                                                                                                                                                           |

### 6.2 Static gates (all local, measured 2026-11-02 refresh)

- JavaScript syntax gate `scripts/check_syntax.js`: parses every `.js`/`.mjs`
  under `main.js`, `preload.js`, `src`, `test`, `scripts`. Fresh run:
  **466/466** files parsed, 0 failures.
- ESLint (full config; production code must not import the test tree; tests
  must use seeded PRNGs): 0 errors.
- TypeScript `tsc --pretty false` (`allowJs`, `checkJs: false`): 0 errors.
- Prettier review-scope check: clean. The maintained-file check
  (`npm run format:check`) is **FAIL** on 7 branch-gap test files
  (`test/test_coverage_branch_gap{11,22,23,24,25,27,28}.js`); none of the
  four industrialization docs is affected.
- Static IPC registration (`scripts/check_ipc.js`): 180/180 preload channels
  mapped; 0 unmapped (up from 174 with the new cosim/materials/optics routes).
- Renderer sink inventory (`scripts/check_renderer_sinks.js`): 2 renderer
  documents, 36 first-party scripts, 16 reviewed `innerHTML` assignments,
  1 excluded vendor script.
- Dependency audit `npm audit --audit-level=high`: **0 vulnerabilities**
  (Electron 45.1.0; earlier `extract-zip` findings cleared, minimatch override
  resolved the 19 moderate findings). This is dependency-audit evidence only,
  not a complete security review.
- SBOM: CycloneDX/SPDX artifacts regenerated for current lockfile SHA-256
  `360d0c0e6341164eba8756d731ae61eb365985d1101f4da578f02229e0845666`.
  Manual license/provenance review remains incomplete.
- Determinism (`scripts/check_determinism.js`): **PASS** — capability matrix
  byte-identical (26,063 bytes, sha256 `0c8355…`); seeded PRNG replay
  identical (8,192 bytes, sha256 `31c020…`).
- Claims-language gate (`scripts/check_claims_language.js`): **FAIL** (exit 1)
  — one finding at `src/core/cae/shell_assembly.js:16` (gate-banned term in a
  source comment; not in the industrialization docs). Triage pending before the
  gate can count as a confidence measure.
- Poisson performance budget (`npm run test:poisson-budget`): **PASS** —
  **4,493.5 ms / 10,000 ms** for the 99,856-unknown grid (316² → 99,856
  unknowns; 2D Poisson DST-I direct); solver and independently recomputed
  relative residuals both **9.676775e-12**. Timing is local and not
  cross-runner evidence.

### 6.3 V&V readiness and reference cases

The validation diagnostic runner (`npm run test:vv`, `test/vv/run_vv.js`)
reports **22 listed diagnostics: 21 PASS, 0 UNAVAILABLE, 1 FAIL** (measured
2026-11-02; verified live on this checkout). It exits 1 on the failure.

| ID                                          | Result (2026-11-02)                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NAFEMS_LE1`                                | PASS — σ_y(D) 92.697 MPa vs 92.7 MPa (−0.003%, ±3.5%)                                                                                                                                                                                                                           |
| `NAFEMS_LE10`                               | PASS — σ_yy(D) −5.218 MPa vs −5.38 MPa (−3.01%, ±5%)                                                                                                                                                                                                                            |
| `NAFEMS_FV32`                               | PASS — 44.629 Hz vs 44.623 Hz (+0.014%, ±2%)                                                                                                                                                                                                                                    |
| `NAFEMS_T1`                                 | PASS — 18.18 °C vs 18.3 °C (0.118 °C deviation, ±0.5 °C)                                                                                                                                                                                                                        |
| `NASA_TMR_FLAT_PLATE`                       | PASS — Cf error **0.6886%** vs 4% tolerance (measured Cf 0.002772859 vs 0.002753896); stationarity passes (wall-Cf range 0.0868%, profile drift 0.0925% over 20 steps, 1% limits); finite after 1,800 steps                                                                     |
| `MANUFACTURED_SPARSE_SPD`                   | PASS — manufactured verification                                                                                                                                                                                                                                                |
| `POISSON_2D_SINE_MMS`                       | PASS — manufactured verification; observed order 2.0494/2.0236 (target 1.9–2.1)                                                                                                                                                                                                 |
| `MOOSE_TIMOSHENKO_CANTILEVER_10_ELEMENT`    | PASS — 0.2401% (same published source, not independent review)                                                                                                                                                                                                                  |
| `MOOSE_EULER_CANTILEVER_10_ELEMENT`         | PASS — 0.2632% (same published source, not independent review)                                                                                                                                                                                                                  |
| `HERTZ_ANALYTICAL_FORMULA`                  | PASS — analytic only                                                                                                                                                                                                                                                            |
| `HERTZ_CONTACT_CLOSED_FORM_ANALYTIC`        | PASS — analytic substitute (p0 4% / contact radius 3%; no discrete contact solve)                                                                                                                                                                                               |
| `SPARSE_SPD_GENERATED_SUITE`                | PASS — generated substitute (not original NIST archive)                                                                                                                                                                                                                         |
| `CANTILEVER_FIRST_MODAL_ANALYTIC`           | PASS — 0.0377% (analytic substitute; not Hannover laboratory data)                                                                                                                                                                                                              |
| `NAFEMS_LE11`                               | **FAIL** — measured σ_z(A) +9.13 MPa vs −105 MPa reference (108.7% deviation beyond ±5%) under the both-ends axial restraint set (nodal-extrapolated corner value; element-averaged σ_z(A) = −109.7 MPa). The failure is recorded and fail-closed; no canned value replaces it. |
| `ISO10110_SINGLET_SURFACE_FORM`             | PASS — Strehl 0.963 vs 0.8 floor (analytic substitute; not an ISO data artifact)                                                                                                                                                                                                |
| `ELASTICITY_PATCH_HEX20`                    | PASS — max relative stress error 0.0088% vs 0.1% (independent Hooke-law reference)                                                                                                                                                                                              |
| `LAME_CYLINDER_INTERNAL_PRESSURE`           | PASS — max relative error 6.78% vs 10% (Lamé plane-strain closed form vs production HEX20 FEA)                                                                                                                                                                                  |
| `BEAM_EULER_BERNOULLI_SS_FREQUENCIES`       | PASS — max relative frequency error 0.0286% vs 2% (modes monotonic; L/h = 200)                                                                                                                                                                                                  |
| `THERMAL_STRESS_FULLY_CONSTRAINED_CYLINDER` | PASS — mean relative error ~2.9e-14% vs 0.1% (target −500 MPa; production thermoelastic path)                                                                                                                                                                                   |
| `MMS_ELASTICITY_HEX20_BODYFORCE`            | PASS — max relative error 0.0031% vs 0.1% (displacement + recovered element stress)                                                                                                                                                                                             |
| `ODE_SPRING_MASS_DAMPER_TRANSIENT`          | PASS — max relative position error 3.9e-7% vs 0.01% (production RK4)                                                                                                                                                                                                            |
| `SHELL_SS_SQUARE_PLATE_DEFLECTION`          | PASS — 1.2668% vs 3% (Kirchhoff series vs production MITC4 shell assembly; 10×10, 726 DOF; 12×12 error 1.0214%, convergence decreasing)                                                                                                                                         |

Notes:

- The five rows that failed in the 2026-10-31 runner (NASA_TMR, CHANNEL
  Poiseuille, NAFEMS_LE1/LE11/T1) are superseded: `CHANNEL_POISEUILLE_…` and
  `PLATE_THICKNESS_OPD_ANALYTIC` were removed from the runner and are not
  claimed; NAFEMS LE1/LE11/T1, FV32, and ISO 10110 rows now execute real
  NAFEMS/ISO-style references, with LE11 failing honestly; NASA_TMR passes.
- The production `VVRegistry` is separate from this test runner. It registers
  generated/analytic diagnostics under descriptive IDs and returns unavailable
  for the original named NIST, Hannover, discrete-Hertz-3D, and ISO slots.
  Readiness remains false and all results remain experimental.
- All results are labeled experimental and are not released validation
  or independent qualification data. The diagnostics are analytic, discrete,
  manufactured/generated, or cross-solver checks; passing assertions do not
  establish solver accuracy, standards compliance, or certification.

### 6.4 Coverage

- V8 loaded-source coverage (instrumented run completed 2026-11-02, verified
  from the run artifacts): **4,481 / 4,955 functions (90.4%)**, **96,720 /
  99,150 lines (97.5%)**, and a branch-proxy of **17,476 / 20,560 non-entry
  blocks (85.0%)** across **268 production files**. All three metrics are at or
  above the configured 85% floors (branch proxy is exactly at the floor).
- Previous measured states are superseded: 3,520/3,610 functions (97.5%) and
  72,741/75,051 lines (96.9%) with branch 68.9% across 238 files (2026-10-31);
  3,783/4,228 functions (89.5%) / 79,779/89,988 lines (88.7%) / branch 77.3%
  across 260 files (2026-11-01 late); 3,627/3,815 functions (95.1%) /
  75,911/80,880 lines (93.9%) / branch 78.1% across 244 files (2026-11-01
  evening).
- Coverage measures function entries and executable lines of loaded source only
  (module-initialization ranges excluded). The branch metric is a V8
  block-transition proxy (non-entry ranges treated as branch-target blocks),
  not MC/DC, and coverage does not by itself satisfy DO-330 verification
  objectives.
- Poisson timing is not scored under V8 instrumentation; the isolated budget
  gate in Section 6.2 is the scored check.

### 6.5 Build-wave evidence (2026-11-01)

The new build-wave modules are real capabilities with passing standalone
suites, verified on this checkout on 2026-11-01 late:

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

### 6.6 Tool-specific behavior notes

- The legacy ASME-labeled screen and the new Part 5 linearization module do
  **not** emit certificates; `generateComplianceCertificate` and
  `generateFormalCertificationDocument` return explicit non-certificate
  warnings.
- Results are labeled `screening-only` / `caller-supplied-unverified`; the
  limit basis is the caller's declaration and is not verified by the tool.
- The qualification kit (`tool_qualification_kit.js`) always returns
  `certificationClaimed: false` and reports `evaluateDO330TQL()` as
  unsupported; see Section 6.7.

### 6.7 Anti-facade remediation summary (8 items)

The eight previously identified computational facades (modules that returned
canned figures while presenting them as solver output) were remediated; full
details are in `docs/industrialization/anti_facade_remediation.md`:

1. **Explicit dynamics** — real central-difference (velocity Verlet) time
   integration with measured energy diagnostics; no canned post-impact
   figures (`src/core/cae/explicit_dynamics_crash.js`).
2. **VOF** — real operator-split grid advection with SLIC-style interface
   reconstruction; mass conservation measured from the grid; surge-correlation
   fit explicitly labeled a fit (`src/core/cae/vof_multiphase_solver.js`).
3. **Turbomachinery** — real Euler-stage velocity-triangle model with
   documented Wiesner/Stanitz slip correlations and computed hydraulic losses;
   efficiency derived from computed losses, not a fitted parabola
   (`src/core/cae/sliding_mesh_turbomachinery.js`).
4. **GPU PCG** — honest parallel worker-pool implementation (SharedArrayBuffer
   - Atomics) with measured wall-clock throughput; no WebGPU claim; fallback
     reported truthfully (`src/core/math/gpu_parallel_pcg_solver.js`).
5. **CCS timing** — real transient table-driven RK4 model with measured delay/
   slew; illustrative placeholder table explicitly labeled
   (`src/core/eda/ccs_timing_model.js`).
6. **Qualification kit** — evidence-based, non-claiming: `certificationClaimed:
false`, fail-closed verdicts, static DO-330/ISO entry points unsupported
   (`src/core/compliance/tool_qualification_kit.js`).
7. **Persistent naming** — topology-aware identities from canonical geometric
   keys with operation/lineage history; no feature-local sequential index as
   sole identity (`src/core/cad/persistent_naming_manager.js`).
8. **STEP export** — emits ISO 10303-42 NURBS surface records (degree-1×1
   and rational B-spline patches) with parser round-trip counting; no
   unqualified conformance claim (`src/core/cad/step_translator.js`).

Post-remediation pattern scans over `src/` show zero remaining occurrences of
canned diagnostic literals, fake GPU assignments, parabolic efficiency fits,
fabricated PASS strings, or `success: true` returns without real computation
(see the sweep table in the remediation record). The behavior is guarded by
`test/test_gold_benchmarks_3.js`, `test/test_coverage_core_solvers.js`,
`test/test_coverage_domain_solvers_ipc.js`,
`test/test_coverage_engine_adapters.js`, and
`test/test_cad_industrial_upgrade.js`, all of which pass in the master suite.

### 6.8 Requirements ↔ evidence traceability matrices (bidirectional)

The verification below is the internal, evidence-based traceability map for
the R0 release train, maintained in this dossier and enforced against
`docs/industrialization/requirements_traceability.md` by
`scripts/check_requirements_coverage.js` (40 requirements parsed, 37
IMPLEMENTED, 0 missing artifacts, gate PASS on 2026-11-02). This is an
engineering traceability record, **not** a DO-330 TOR-to-test-case trace or a
reviewed verification record (Section 7).

#### 6.8.1 Matrix A — Requirements → evidence

Rows = the 40 R0 requirements; columns = verification evidence classes (V&V
diagnostics, test suites, automated/static gates and documentation, production
code modules). Empty cells are marked `—`; a requirement is _mapped_ when at
least one evidence cell is non-empty. A `GAP` status means no local evidence
exists.

| REQ-ID  | V&V diagnostics                                                                                                                                                                                                                                                                                                                           | Test suites                                                                        | Gates / documentation                                                                           | Code modules                                                                                              | Status / gap                                                                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-001 | readiness flags false; `test_vv_status_contract.js`                                                                                                                                                                                                                                                                                       | `test/test_vv_status_contract.js`                                                  | `docs/industrialization/vv_report.md`                                                           | `src/core/vv/validation_readiness.js`                                                                     | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-002 | `NAFEMS_LE11` (FAIL recorded), `NASA_TMR_FLAT_PLATE` (PASS)                                                                                                                                                                                                                                                                               | `test/test_vv_status_contract.js`                                                  | `scripts/generate_vv_report.js`; exit 1 on failure                                              | `src/core/vv/validation_readiness.js`                                                                     | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-003 | `NAFEMS_LE1`, `NAFEMS_LE10`, `NAFEMS_FV32`, `NAFEMS_T1`, `NAFEMS_LE11`, `NASA_TMR_FLAT_PLATE`, `ISO10110_SINGLET_SURFACE_FORM`, MOOSE pair                                                                                                                                                                                                | `test/test_vv_status_contract.js`                                                  | `docs/industrialization/reference_registry.md`                                                  | `src/core/vv/benchmark_runners.js`                                                                        | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-004 | `POISSON_2D_SINE_MMS`, `MANUFACTURED_SPARSE_SPD`, `SPARSE_SPD_GENERATED_SUITE`, `LAME_CYLINDER_INTERNAL_PRESSURE`, `ELASTICITY_PATCH_HEX20`, `BEAM_EULER_BERNOULLI_SS_FREQUENCIES`, `THERMAL_STRESS_FULLY_CONSTRAINED_CYLINDER`, `MMS_ELASTICITY_HEX20_BODYFORCE`, `ODE_SPRING_MASS_DAMPER_TRANSIENT`, `SHELL_SS_SQUARE_PLATE_DEFLECTION` | `test/vv/run_vv.js`                                                                | `docs/industrialization/vv-diagnostic-report.md`                                                | `src/core/math/poisson_2d_direct.js`                                                                      | mapped — IMPLEMENTED; note: the dedicated Kirsch analytic row was superseded by the FEA/analytic diagnostic family (LE1/LE11, patch, Lamé FEA); the manufactured/analytic set still runs |
| REQ-005 | —                                                                                                                                                                                                                                                                                                                                         | FVM typed-error coverage tests                                                     | `docs/industrialization/fvm_hardening_report.md`                                                | `src/core/cae/fvm_navier_stokes_3d.js`                                                                    | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-006 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_fvm_turbulence_stability.js` (6/6)                                      | `docs/industrialization/fvm_hardening_report.md`                                                | `src/core/cae/fvm_navier_stokes_3d.js`                                                                    | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-007 | `POISSON_2D_SINE_MMS` (order 2.0494/2.0236)                                                                                                                                                                                                                                                                                               | `test/test_mms_grid_convergence.js`                                                | gate runs inside root suite                                                                     | `src/core/math/poisson_2d_direct.js`                                                                      | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-008 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_coverage_core_solvers.js`                                               | —                                                                                               | solvers under `src/core/math/*`, `src/core/cae/*`                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-009 | —                                                                                                                                                                                                                                                                                                                                         | `test/run_all_tests.js`; `scripts/run_tests_clean.js` guard                        | master suite results (Section 6.1)                                                              | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-010 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_coverage_remaining_modules.js` (17/17)                                  | coverage gates (Section 6.4)                                                                    | previously unreferenced modules                                                                           | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-011 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_mms_grid_convergence.js` inside root suite                              | gate run                                                                                        | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-012 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | syntax 466/466; ESLint 0; tsc 0; IPC 180/180; sink inventory clean; Prettier review-scope clean | `scripts/check_syntax.js`, `scripts/check_ipc.js`, `scripts/check_renderer_sinks.js`, `eslint.config.mjs` | mapped — IMPLEMENTED (note: maintained-Prettier open items on 7 test files, Section 6.2)                                                                                                 |
| REQ-013 | —                                                                                                                                                                                                                                                                                                                                         | sender-guard assertions in master suite                                            | —                                                                                               | `src/main/ipc/define_handler.js`, `src/core/security/ipc_validator.js`                                    | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-014 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `npm audit` 0 vulnerabilities; SBOM regenerated                                                 | `docs/sbom/omnieng-dependencies.cdx.json`, `docs/third_party_notices.md`                                  | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-015 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/security/threat_model.md`                                                                 | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-016 | —                                                                                                                                                                                                                                                                                                                                         | determinism check PASS                                                             | secret-pattern scan; ESLint PRNG rule; `git diff --check`                                       | `eslint.config.mjs`                                                                                       | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-017 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/packaging_report.md`                                                    | `electron-builder.yml`                                                                                    | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-018 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | packaging checkpoint: unpacked build exit 0; ASAR byte-match                                    | packaging artifacts                                                                                       | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-019 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | recorded launch evidence on earlier Electron build (43.8.6 `--test-ui`, exit 0, macOS 12.7.6)   | packaged app                                                                                              | mapped — IMPLEMENTED with caveat: current Electron 45.1.0 package built but not launched on this host (macOS 13 minimum vs host 12.7.6)                                                  |
| REQ-020 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | —                                                                                               | —                                                                                                         | **GAP** — EXTERNAL-BLOCKED (Apple Developer ID / notarization infrastructure absent)                                                                                                     |
| REQ-021 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | this dossier                                                                                    | `docs/industrialization/certification/do330_tql_dossier.md`                                               | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-022 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/certification/iso26262_safety_case.md`                                  | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-023 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/certification/evidence_ledger.md`; `certificationClaimed: false`        | `src/core/compliance/tool_qualification_kit.js`                                                           | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-024 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | —                                                                                               | —                                                                                                         | **GAP** — EXTERNAL-BLOCKED (accredited conformity assessment infrastructure absent)                                                                                                      |
| REQ-025 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_shared_contracts.js`                                                    | —                                                                                               | `src/core/contracts/JobRequest.js`, `src/core/contracts/engine_registry.js`                               | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-026 | `SHELL_SS_SQUARE_PLATE_DEFLECTION` (explicit-input shell route)                                                                                                                                                                                                                                                                           | adapter coverage suites                                                            | `docs/industrialization/anti_facade_remediation.md`                                             | build-wave adapters (materials/optics/plant/robotics/EDA/CAM/aerospace/FMI/HPC)                           | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-027 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `scripts/generate_capability_matrix.js`; matrix deterministic                                   | `docs/industrialization/capability_matrix.md`                                                             | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-028 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_preload_compatibility.js`                                               | IPC registration 180/180, 0 duplicates                                                          | preload surface                                                                                           | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-029 | current runner state                                                                                                                                                                                                                                                                                                                      | —                                                                                  | `docs/industrialization/status.md`, `docs/known_limitations.md`                                 | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-030 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/mercury_inception/ENGINEERING_PROTOCOL.md`, `SETUP_VERIFICATION.md`     | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-031 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_requirements_coverage.js`                                               | `scripts/check_requirements_coverage.js` PASS (40/37/0)                                         | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-032 | —                                                                                                                                                                                                                                                                                                                                         | maturity-registry assertions in master suite                                       | `docs/industrialization/readiness_scorecard.md`                                                 | `src/core/maturity/feature_maturity.js`                                                                   | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-033 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | Poisson budget PASS (4,493.5 ms / 10,000 ms; residual 9.676775e-12)                             | `scripts/run_poisson_budget.js`, `src/core/vv/poisson_performance.js`                                     | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-034 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/industrialization/performance_report.md`                                                  | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-035 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `.github/workflows/ci.yml` (config only; no hosted results; no remote)                          | —                                                                                                         | **GAP** — EXTERNAL-BLOCKED                                                                                                                                                               |
| REQ-036 | —                                                                                                                                                                                                                                                                                                                                         | `test/test_worker_pool_concurrency.js`; `test/test_hpc_local_scheduler.js` (71/71) | —                                                                                               | `src/core/hpc/*`                                                                                          | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-037 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `package.json` (`engines.node` >= 22.12.0; pinned)                                              | `package.json`                                                                                            | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-038 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | `docs/third_party_notices.md` regenerated with SBOM                                             | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-039 | reference provenance rows                                                                                                                                                                                                                                                                                                                 | —                                                                                  | `docs/data_provenance.md`, `docs/industrialization/reference_registry.md`                       | —                                                                                                         | mapped — IMPLEMENTED                                                                                                                                                                     |
| REQ-040 | —                                                                                                                                                                                                                                                                                                                                         | —                                                                                  | launch evidence recorded in `docs/industrialization/status.md`                                  | packaged runtime                                                                                          | mapped — IMPLEMENTED with caveat: update/rollback evidence remains external                                                                                                              |

**Counts:** 40 requirements listed; **37 mapped to evidence** (IMPLEMENTED),
**3 gaps** (REQ-020, REQ-024, REQ-035 — all EXTERNAL-BLOCKED, no local
evidence). Informational caveats: REQ-004 (dedicated Kirsch row superseded by
the FEA/analytic family), REQ-019 and REQ-040 (launch evidence on an earlier
Electron build).

#### 6.8.2 Matrix B — Evidence → requirements

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

## 7. Gaps against DO-330 (TQL-5) evidence

1. **No tool operational requirements (TOR) document.** No approved,
   traceable statement of what the tool must do, the intended usage, and
   operational constraints exists.
2. **Traceability map is internal, not a DO-330 trace.** The bidirectional
   matrices in Section 6.8 map R0 requirements to evidence, but there is no
   TOR-derived test-case set, no test-case review record, and no independent
   verification of the test suites against a TOR.
3. **No DO-330 life-cycle process data.** No development plan (PL), software
   development standards (SD), verification plan, or configuration
   management plan (SC) are maintained as DO-330 artifacts.
4. **No configuration management/change records.** The repository uses git
   with reversible commits but has no controlled release baseline, no change
   control process, and no recorded problem reports (anomaly tracking).
5. **No qualification environment evidence.** TQL-5 qualification is
   environment-specific; Windows/Linux/hosted CI execution has no results
   (REQ-035 gap), and the current packaged app has not been launched
   (REQ-019/REQ-040 caveats).
6. **No independence.** Development and verification are performed by the
   same engineering stream; no independent reviewer/audit records exist.
7. **No criteria analysis against a program.** The provisional TQL-5
   classification has not been exercised against a specific aircraft
   development program, certification plan, or DO-178C tool-chain interface.
8. **No deployment/installation qualification.** The npm package is
   unreleased; no signed distribution or installation verification exists
   (REQ-020 gap).
9. **No personnel competency records.** No qualification/training records
   for personnel performing analysis with the tool are maintained.
10. **No DO-330 checklist completion.** No completed DO-330 objective
    checklist (e.g., TQL-5 verification objectives) is maintained.
11. **Unresolved gate findings.** The claims-language gate FAILs on one
    source-comment finding (`src/core/cae/shell_assembly.js:16`); the
    maintained-Prettier check FL on 7 branch-gap test files; the
    `NAFEMS_LE11` V&V diagnostic fails (108.7% nodal-extrapolated deviation);
    the Hannover genuine reconstruction (f1/f2) and PlantEngineAdapter
    coverage-count failures are recorded in the instrumented integrated run.
    The branch-coverage proxy is exactly at the 85% floor, not comfortably
    above it.

## 8. NOT YET CERTIFIED statement

**This tool is NOT YET CERTIFIED under RTCA DO-330.** No tool qualification
level has been granted by any certification authority, airworthiness
authority, or employer-designated qualification body. The provisional TQL-5
target in this dossier is a planning artifact. Nothing in this repository —
including this dossier, the traceability matrices in Section 6.8, the legacy
"certificate" generator methods, or any report text — constitutes a tool
qualification certificate, DO-178C approval, or certification credit. Using
this tool for certification-credit verification activities is **not
authorized** on the basis of current evidence.

## 9. Roadmap

1. Publish a TOR for the stress linearization module, the solver adapters,
   and the build-wave modules, with functional and performance requirements.
2. Convert the internal Section 6.8 traceability into a TOR → test-case →
   result trace with review records for the targeted suites listed in
   Section 6.1.
3. Introduce a problem-report and change-control record process; anchor
   releases with signed git tags and SBOMs.
4. Re-run the targeted suites under Node 22.x and 24.x on Linux/Windows
   runners with hosted CI results recorded in this dossier (REQ-035).
5. Perform a DO-330 Criteria analysis (Criteria 1–3) for each tool function
   and record the resulting classification rationale (expected TQL-5 for
   development-only review aids).
6. Commission an independent review of the verification suites for the
   linearization module, solver adapters, and build-wave modules.
7. Document the DO-178C interface (which artifact types the tool touches,
   and which verification activities it is excluded from).
8. Triage or remediate the open gate findings in Section 7 item 11
   (claims-language comment, maintained-Prettier files, LE11 diagnostic,
   Hannover reconstruction, adapter coverage count) and re-run the gates.
9. Re-issue this dossier as a completed TQL-5 evidence package for
   qualification consideration — still contingent on authority/employer
   acceptance.

---

_End of dossier. Prepared as an honest evidence record; it deliberately claims
no certification._
