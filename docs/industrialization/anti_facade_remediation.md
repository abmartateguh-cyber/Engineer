# Anti-Facade Remediation Record

<!-- claims:evidence:anti_facade_remediation.md recorded invariants and code line refs (line 116 validateTable strict-finite-grid checks); remediation evidence record, not a certification claim -->

Date: 2026-10-28. Scope: the eight previously identified computational facades
(modules that returned canned figures while presenting them as solver output).
Each entry lists the file, what changed, and the verification invariants that
guard the behavior. All modules remain experimental and not release-approved.

## 1. Explicit dynamics — real central-difference integration

**File:** `src/core/cae/explicit_dynamics_crash.js`

**Before:** `simulateTaylorBarImpact` returned canned post-impact figures:
`finalPlasticWork = initialKineticEnergy * 0.92`,
`residualElasticEnergy = initialKineticEnergy * 0.08`, and a hard-coded
`energyBalanceErrorPercent: 0.02` without running any time integration.

**After:** a genuine explicit central-difference (velocity Verlet) time loop on
a 1D rod finite-element mesh (`simulateTaylorBarImpact`, line 91): lumped mass
matrix, internal forces from the actual element strain, elasto-plastic stress
update with radial-return mapping (hardening modulus H, default E/50),
semi-implicit penalty wall contact, CFL-limited time step from the real acoustic
wave speed. All diagnostics are measured from the evolved fields (line 218–224,
259): kinetic energy, strain energy, accumulated plastic work, contact penalty
energy, and the energy-balance residual computed from the actual totals. The
returned `energyBalanceErrorPercent` / `maxEnergyBalanceErrorPercent` are the
measured residuals, not constants.

**Invariants:** no `0.92` / `0.08` / `0.02` literals in the solver output path;
the trace records per-step measured energy; a non-finite total throws instead of
returning a number. Covered by `test/test_gold_benchmarks_3.js`.

## 2. VOF — real grid advection

**File:** `src/core/cae/vof_multiphase_solver.js`

**Before:** the dam-break routine returned a front position and velocity from a
closed-form surge correlation (`x = w·(1 + 2.56·τ^0.92)`, `u = 2.56·0.92·τ^-0.08·...`)
and fixed diagnostics.

**After:** `advect` (line 243) performs operator-split geometric flux sweeps on
the volume-fraction field with SLIC-style donor-acceptor interface
reconstruction; `simulateDamBreak` (line 286) runs that advection for a
collapsing water column and measures the front position and velocity from the
advected field, plus the measured mass-conservation error (line 411). The
power-law fit is returned only as an explicit fit of the measured trace
(`type: 'power_law_fit_of_measured_front'`, line 474) with the note "Fit of
the measured front trace; not the solver itself."

**Invariants:** mass conservation error is computed from the grid
(`|ΣC_final − ΣC_initial| / ΣC_initial`); the fit object is explicitly labeled
a fit; no surge-correlation exponents remain. Covered by
`test/test_gold_benchmarks_3.js`.

## 3. Turbomachinery — real Euler-stage + loss models

**File:** `src/core/cae/sliding_mesh_turbomachinery.js`

**Before:** `evaluatePumpOperatingPoint` computed Euler head but derived
efficiency from an arbitrary parabola
`η = max(0.3, min(0.88, 0.85 − 0.25·((Q − 0.02)/0.02)²))` and returned it as
`hydraulicEfficiencyPercent`.

**After:** the stage model is built from velocity triangles (inlet/outlet
stations), a documented slip correlation (Wiesner 1967 default; Stanitz 1952
selectable — `computeSlipFactor`, line 77), the Euler head from the actual
components (line 143–144), and computed hydraulic losses: Darcy–Weisbach
passage friction on the mean meridional path and inlet incidence loss
(line 151–157). Hydraulic efficiency is derived from the computed losses
(line 158); the characteristic-curve BEP is found by scanning the computed
efficiency curve, not by fitting (line 249–263).

**Invariants:** no `efficiency = Math.max(...)` or `0.85 − 0.25` parabola
anywhere in the codebase; the returned object exposes the loss components and
the slip model used (`slipCorrelation`, `hydraulicEfficiency`). Covered by
`test/test_coverage_core_solvers.js`.

## 4. GPU PCG — honest parallel worker-pool implementation

**File:** `src/core/math/gpu_parallel_pcg_solver.js`

**Before:** advertised GPU acceleration and canned speedup/throughput figures.

**After:** the solver makes no WebGPU claim (header, line 3–21). The SpMV hot
loop is distributed across real worker threads via the production
`PersistentWorkerPool` with `SharedArrayBuffer`-backed CSR/vector buffers and
an Atomics barrier (`_initParallel`, `_parallelSpmv`, line 93–198); if the
parallel probe fails, the solver falls back to serial JavaScript and reports the
fallback truthfully. Throughput is measured from real wall-clock timestamps:
`GFlop/s = iterations × nnz × 2e-9 / elapsed seconds` (line 439–440).
`hardwareAcceleration` mirrors the actual backend string
(`'cpu-parallel-workerpool'` or `'cpu-serial-javascript-fallback'`, line 438)
and `gpuSpeedupVerified: false` is always returned (line 459).

**Invariants:** no `'WebGPU'` backend string is ever emitted as an executed
backend; `gpuDetected` and `webgpuRequested` are reported separately from the
executed backend; a non-positive-diagonal or malformed matrix throws before any
solve. Covered by `test/test_gold_benchmarks_3.js`,
`test/test_coverage_domain_solvers_ipc.js`.

## 5. CCS timing — real transient table-driven model

**File:** `src/core/eda/ccs_timing_model.js`

**Before:** stage delay was produced from a closed-form Gaussian waveform
approximation with no supporting characterization.

**After:** the driver is characterized from a 2D current lookup table
I(Vin, Vout) (bilinear interpolation, `interpolateCurrent`, line 130); the
output node obeys dVout/dt = (I − Vout/Rload)/Ctotal integrated with the
production RK4 solver (`_integrate`, line 217). Delay and slew are measured
from the simulated waveform crossings (line 279–286). The built-in default
table is explicitly labeled an illustrative placeholder (`tableSource:
'built-in-illustrative'`, line 296), and sign-off characterization requires a
user-supplied table passed to `characterizeCell`.

**Invariants:** no fabricated closed-form waveform; every table is validated
(`validateTable`, line 84: strictly increasing finite grids, matching current
matrix); the result reports `integrator: 'RK4'` and the table source. Covered
by `test/test_gold_benchmarks_3.js`, `test/test_coverage_engine_adapters.js`.

## 6. Qualification kit — evidence-based, non-claiming

**File:** `src/core/compliance/tool_qualification_kit.js`

**Before:** emitted pass/fail verdicts labeled as tool qualification/certification.

**After:** `evaluateEvidence` (line 363) evaluates caller-supplied factual
evidence against the documented criteria table and always returns
`certificationClaimed: false` (line 453) with a verdict of
`evidence-insufficient` or `evidence-satisfies-{level}`. Missing evidence fails
closed (`incomplete: true`). The static `evaluateDO330TQL` /
`evaluateISO26262TCL` entry points return unsupported/experimental rather than
performing an assessment. The PASS/FAIL strings that remain are report rows in
the diagnostic generator (`generateExperimentalDiagnosticReport`, line 165) and
criteria reasoning strings — output labels, not solver claims.

**Invariants:** every result object carries `certificationClaimed: false`; a
missing evidence field makes `complete` false and the verdict
`evidence-insufficient`; runtime SBOM generation throws. Covered by
`test/test_coverage_core_solvers.js`.

## 7. Persistent naming — topology-aware

**File:** `src/core/cad/persistent_naming_manager.js`

**Before:** tags were generated from feature-local sequential indices without
topological identity, losing entities across edits.

**After:** identities derive from canonical geometric keys computed from actual
geometry (`computeGeometryKey`, line 79: coordinates for vertices, canonicalized
endpoints + midpoint for edges, centroid + normal + area for faces) and from
Euler-operator-style topology operations (`registerTopologicalEntities`,
`recordOperation`, line 176/287) with split/merge lineage tracked in a queryable
history log and `traceEntity`/`resolveTag` traversal.

**Invariants:** same geometry regenerates the same tag (`getOrCreateEntityByGeometry`);
history entries carry `op`, `entityIds`, `lineage`, and `resultIds`; no
feature-local sequential index is used as the sole identity. Covered by
`test/test_cad_industrial_upgrade.js`, `test/test_gold_benchmarks_3.js`.

## 8. STEP — emits NURBS surfaces

**File:** `src/core/cad/step_translator.js`

**Before:** STEP export emitted planar tessellation only and was previously
advertised as a full STEP capability.

**After:** `exportNurbsSurfaces` (line 217) emits ISO 10303-42 NURBS surface
records: planar faces as degree-1×1 `B_SPLINE_SURFACE_WITH_KNOTS` patches
(line 335) and cylindrical faces as exact 90-degree `RATIONAL_B_SPLINE_SURFACE`
patches with documented conic weights (line 352). `parseSTEP` counts the
emitted surface entities back (line 912) for round-trip validation. The header
documents that general ISO 10303 conformance is not independently verified.

**Invariants:** the NURBS export path is separate from the legacy single-part /
assembly paths; the parser round-trips `bSplineSurfacesCount` /
`rationalBSplineSurfacesCount`; no unqualified conformance claim is emitted.
Covered by `test/test_cad_industrial_upgrade.js`.

## Sweep evidence (post-remediation)

Pattern scans over `src/` (excluding `src/vendor/` and `src/public/plugins/`):

| Pattern                                                                      | Count after fixes |
| ---------------------------------------------------------------------------- | ----------------: |
| `WebGPU Compute` / `Emulated` strings                                        |                 0 |
| `hardwareAcceleration` fake GPU assignment                                   |                 0 |
| `efficiency = Math.max(` / `0.85 - 0.25` parabolic fits                      |                 0 |
| `Moyce` / `Martin` / non-documented `1952`                                   |                 0 |
| Canned diagnostics (`* 0.92;`, `* 0.08;`, `energyBalanceErrorPercent: 0.02`) |                 0 |
| `PASS` strings in non-test solver modules                                    |                 0 |
| `toFixed(2)` throughput/GFlops with fabricated denominators                  |                 0 |
| `success: true` solver returns without real computation                      |                 0 |

Remaining occurrences of the numeric patterns are genuine documented models with
explicit source comments: Bartz / Dittus–Boelter correlations
(`src/core/aerospace/nasa_rocket_propulsion.js` lines 439–449), k-omega SST
constants (`src/core/cae/fvm_navier_stokes_3d.js` line 71–80), the 1-2 TEMA E
F-correction chart limit (`src/core/plant/heat_exchanger_tema.js`), the
illustrative LP placeholder ratios (`src/core/optics/stop_multiphysics_coupling.js`),
and numeric floors/safeguards (e.g. `src/core/cae/johnson_cook_fracture.js`).
