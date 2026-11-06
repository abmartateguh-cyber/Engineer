# Remaining R0 Blocked Gaps (Honest Record)

**Date:** 2026-11-01
**Verdict:** NOT RELEASABLE / R0 remains open
**Status:** This record is live-measured from the current runner state. While any gate below fails, OmniEng makes **no certification and no 100% (all-diagnostics-passing) claim**.

---

## 1. Current V&V runner state (21 rows)

Command: `node test/vv/run_vv.js` (Node v24.16.0, darwin). Captured 2026-11-01.

|   # | Result | ID                                        | Check                                                                                                                      |
| --: | ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
|   1 | PASS   | NAFEMS_LE1                                | 2D Q8 plane-stress quarter-ellipse, sigma_y at D                                                                           |
|   2 | PASS   | NAFEMS_LE10                               | 3D thick quarter-elliptic annular plate under 1 MPa pressure, sigma_yy at D                                                |
|   3 | PASS   | NAFEMS_FV32                               | Cantilevered tapered membrane, mode 1 natural frequency                                                                    |
|   4 | PASS   | NAFEMS_T1                                 | 2D steady conduction with mixed BCs, T(0.6, 0.2)                                                                           |
|   5 | FAIL   | NASA_TMR_FLAT_PLATE                       | Cf deviates from Karman-Schoenherr correlation by 64.6% (tolerance 4%)                                                     |
|   6 | PASS   | MANUFACTURED_SPARSE_SPD                   | Manufactured sparse SPD verification case                                                                                  |
|   7 | PASS   | POISSON_2D_SINE_MMS                       | Two-dimensional Poisson sine manufactured solution                                                                         |
|   8 | PASS   | MOOSE_TIMOSHENKO_CANTILEVER_10_ELEMENT    | Small strain Timoshenko cantilever bending, ten elements                                                                   |
|   9 | PASS   | MOOSE_EULER_CANTILEVER_10_ELEMENT         | Small-strain high-shear-stiffness cantilever bending, ten elements                                                         |
|  10 | PASS   | HERTZ_ANALYTICAL_FORMULA                  | Hertz closed-form outputs compared with an independent equation evaluation                                                 |
|  11 | PASS   | HERTZ_CONTACT_CLOSED_FORM_ANALYTIC        | Sphere-on-flat Hertz closed-form contact pressure and equilibrium reference (no discrete contact solver executed)          |
|  12 | PASS   | SPARSE_SPD_GENERATED_SUITE                | Generated sparse SPD solver robustness suite over ill-conditioned systems                                                  |
|  13 | PASS   | CANTILEVER_FIRST_MODAL_ANALYTIC           | Cantilever beam first natural frequency, Euler-Bernoulli analytic reference (not Hannover laboratory data)                 |
|  14 | FAIL   | NAFEMS_LE11                               | sigma_z(A) deviates from NAFEMS LE11 reference (-105 MPa) beyond ±5% under the documented symmetric restraint set          |
|  15 | PASS   | ISO10110_SINGLET_SURFACE_FORM             | Real singlet prescription (Sellmeier), ISO 10110 surface-form callout, skew-ray trace, OPD decomposition, RMS WFE + Strehl |
|  16 | PASS   | ELASTICITY_PATCH_HEX20                    | 3D constant-strain patch test on an irregular HEX20 mesh (production FEASolver)                                            |
|  17 | PASS   | LAME_CYLINDER_INTERNAL_PRESSURE           | Thick-walled cylinder, internal pressure: Lame plane-strain closed form vs production HEX20 FEA                            |
|  18 | PASS   | BEAM_EULER_BERNOULLI_SS_FREQUENCIES       | Simply supported Bernoulli beam: first 3 bending frequencies vs Euler-Bernoulli closed form                                |
|  19 | PASS   | THERMAL_STRESS_FULLY_CONSTRAINED_CYLINDER | Uniformly heated fully constrained body: sigma = -E alpha DeltaT/(1-2nu) via production thermoelastic path                 |
|  20 | PASS   | MMS_ELASTICITY_HEX20_BODYFORCE            | Manufactured quadratic elasticity solution with constant body forces (production HEX20 FEA)                                |
|  21 | PASS   | ODE_SPRING_MASS_DAMPER_TRANSIENT          | Spring-mass-damper transient vs damped-harmonic closed form (production RK4)                                               |

**Summary: 19 passed, 0 unavailable, 2 failed (21 listed).**

Two runner rows (11, 13) intentionally substitute passing _analytic_ references for the genuinely failing discrete diagnostics: the 3D contact FEA (`test/test_hertz_3d_contact_fea.js`) and the Hannover genuine reconstruction (`test/test_hanover_beam_dynamics.js`) are NOT part of the 21-row list; both are separate fail-closed tests and are recorded as blocked gaps below.

---

## 2. Blocked gap records

### Gap 1 — NASA_TMR_FLAT_PLATE

- **Diagnostic ID:** NASA_TMR_FLAT_PLATE (runner row 5/21).
- **Status:** FAIL.
- **Measured values (live, 2026-11-01):**
  - Measured Cf = 0.000976 (tau_w = 2.928 Pa) vs expected Karman-Schoenherr Cf = 0.002754 at Re_x = 4.74e6 (Re_theta ≈ 7874).
  - Error = +64.58% (tolerance ±4%). Verified by 4/4 independent live runs (runner and direct probes).
  - Stationarity gate PASSES: wall-Cf range over final 20 steps = 0.633% (<=1%); max profile drift = 0.195% (<=1%).
  - March: 2,000 sweeps (max budget reached); first-cell-center y+ = 36.1 (log-law regime).
  - Production options: `localTimeStepping: true` + `steadyImplicitWallRelax: true`. The explicit pseudo-time march alone does not reach a fixed point; the line-implicit wall relaxation stabilizes the march but converges to a stationary state whose wall shear is far below the correlation.
  - **Note on variance:** the gap ticket records ~9.2% Cf error. That value is NOT reproducible on today's live runs (4/4 give 64.58%). The 9.2% state appears to predate the current solver state; the current measured value of record is 64.58%. A future run that reproduces ~9.2% should be reconciled against this record before closing.
- **Tolerance:** ±4% (Cf).
- **Root cause (verified):** the production near-wall turbulence/wall-model path does not reproduce the Karman-Schoenherr correlation at the station; the explicit pseudo-time march does not converge to a fixed point (drift/departure), and the current stabilization converges to the wrong stationary wall shear.
- **Exact evidence/action needed to close:** an implicit/elliptic near-wall steady-state solver (or an independently verified reduced-order correlation match) that reproduces Cf within ±4% at the station, verified by a PASS runner row.
- **Owner:** internal — implicit FVM solver work.

### Gap 2 — NAFEMS_LE11

- **Diagnostic ID:** NAFEMS_LE11 (runner row 14/21).
- **Status:** FAIL.
- **Measured values (live, 2026-11-01; base mesh 552 elements / 3,546 dof, converged):**
  - Documented restraint set (axial uz=0 on both end faces, per Abaqus Benchmarks Guide 4.2.11, DIANA 10.1 2.1.9, Altair OptiStruct OS-V 0070, FeenoX, NovaSolver, FEATool, PrePoMax): nodal-extrapolated sigma_z(A) = +9.13 MPa (fine mesh +9.95 MPa) → error 108.7%; centroid/element-averaged sigma_z(A) = -109.7 MPa (fine -115.9 MPa); inner-surface point E = -102.6 MPa (fine -105.09 MPa).
  - The ticket-recorded value -77.14 MPa corresponds to the top-face-symmetry-only restraint variant (live-measured -77.1407 MPa; error 26.5% vs 5%).
  - No defensible BC set matches -105 MPa within 5%: full restraint sweep spans [-144, +24] MPa.
- **Tolerance:** ±5%.
- **Root cause (verified):** the production axisymmetric thermoelastic solver is verified correct on closed-form cases (Lame cylinder: 0.06% at 32x8; axial tension: 3.5e-14 relative; free expansion: machine-precision zero; quadrature-order invariant). Geometry is reconstructed from the public FinEtools.jl transcription. The restraint set is resolved from multiple independent verification manuals. The remaining unknown is the **stress-reporting convention at corner point A** (nodal extrapolation vs element/Gauss-point value), which the original NAFEMS P18 (1990) booklet does not expose and which remains paywalled.
- **Exact evidence/action needed to close:** the original P18 page (restraint drawing + point-A stress-reporting convention), or an authoritative restatement of the A-point reporting convention, such that the documented report yields -105 ± 5 MPa.
- **Owner:** external — NAFEMS P18 purchase/scan; internal correspondence with benchmark authority.

### Gap 3 — Hertz 3D contact FEA

- **Diagnostic ID:** test/test_hertz_3d_contact_fea.js (standalone fail-closed diagnostic; runner row 11 is a passing analytic substitute).
- **Status:** FAIL (2/4 checks).
- **Measured values (live, 2026-11-01):**
  - p0 = 1995.1 MPa vs 1860.6 MPa → +7.23% (tolerance ±4%).
  - a = 0.4854 mm vs 0.5066 mm → -4.17% (tolerance ±3%).
  - Extraction: honest Hertz-profile parabola fit (fit RMS = 0.047); raw nodal peak p0 = 2031.9 MPa; raw max-active a = 0.540 mm — raw extraction would over-state both, so the fitted values are the record.
  - Force-exact: applied wedge load 249.39 N vs 250.00 N target.
  - Mesh-converged: 10 um contact rings; mesh 10,206 nodes / 8,200 elements / 30,618 dof; 38 iterations, solverExecuted=true, converged=true.
- **Root cause (verified):** node-to-node penalty/Augmented-Lagrangian linear-Hex8 formulation limit; the formulation cannot represent consistent segment-to-segment contact kinematics/pressure distribution, producing peak-pressure overshoot and contact-radius undershoot.
- **Exact evidence/action needed to close:** a consistent segment-to-segment contact formulation (or mortar/interface element) reproducing p0 within ±4% and a within ±3% under the honest-fit extraction.
- **Owner:** internal — contact solver work.

### Gap 4 — Hannover beam genuine reconstruction

- **Diagnostic ID:** test/test_hanover_beam_dynamics.js (standalone fail-closed diagnostic; runner row 13 is a passing Euler-Bernoulli analytic substitute, explicitly not Hannover data).
- **Status:** FAIL.
- **Measured values (live, 2026-11-01):**
  - Genuine reconstruction f1 = 1.6981 Hz vs declared target 2.65 Hz → -35.92% (target tolerance ±3%).
  - Genuine reconstruction f2 = 10.7754 Hz vs declared target 16.52 Hz → -34.77% (target tolerance ±4%).
  - Synthetic simulation (informational, does not drive verdict): f1 = 1.8766 Hz, f2 = 11.7600 Hz.
- **Root cause (verified):** the pinned dataset (DOI 10.25835/lyav246d, CC BY 3.0) publishes NO natural frequencies; independent model and measured data agree (~1.58 / 10.4 Hz); the declared 2.65/16.52 Hz targets are an unsourceable internal spec.
- **Exact evidence/action needed to close:** a source for the 2.65/16.52 Hz targets (dataset supplement, paper, or lab report), OR an owner decision to re-baseline the benchmark to the measured modal content (currently forbidden by R0 honesty gates).
- **Owner:** owner decision (re-baseline) or external data source.

### Gap 5 — Coverage gate (branch proxy)

- **Diagnostic ID:** `scripts/run_coverage.js` gates (full suite under NODE_V8_COVERAGE).
- **Status:** FAIL (branch), PASS (function, line).
- **Measured values (live, 2026-11-01):**
  - Function coverage: 94.0% (3,611/3,841 functions) — PASS (floor 85%).
  - Line coverage (range-mapped): 92.6% (74,922/80,927 lines) — PASS (floor 85%).
  - Branch coverage (block-transition proxy): 76.3% (11,029/14,462 branch-target blocks) — FAIL (floor 85%).
  - Blocks needed to reach 85%: ceil(0.85 × 14,462) = 12,293 → **1,264 additional covered blocks required** (the earlier ticket estimate of ~1,500 reflected a smaller denominator/branch set; the current measured shortfall is 1,264).
  - Note: the ticket's earlier snapshot (74.5% / 94.8% / 93.1%) predates additional coverage-branch tests; the live values above supersede it.
- **Root cause:** insufficient branch-target block coverage across production modules.
- **Exact evidence/action needed to close:** ~1,264 more covered branch blocks via tests (ongoing coverage-branch extension suite), then rerun `scripts/run_coverage.js` to a PASS on all three floors.
- **Owner:** internal — QA test expansion.

---

## 3. Closing statement

- Today (2026-11-01) the V&V runner reports **19/21 PASS** (2 FAIL: NASA_TMR_FLAT_PLATE, NAFEMS_LE11), and two additional fail-closed diagnostics (Hertz 3D contact FEA, Hannover genuine reconstruction) plus the coverage branch gate remain failed.
- **Verdict: NOT RELEASABLE / R0 remains open.**
- No certification and no 100% claim is made while any gate in this record fails.
- Each gap above lists the exact evidence required to close it and the owning party. No gate is closed by assertion alone; closure requires the listed measured evidence.

_Record generated from live runner output and direct test executions on 2026-11-01 (Node v24.16.0)._
