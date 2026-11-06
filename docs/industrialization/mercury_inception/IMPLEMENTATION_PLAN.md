# OmniEng industrialization implementation plan — Mercury + Mercury

<!-- claims:evidence:IMPLEMENTATION_PLAN.md goal/requirement statements; terms describe planned targets and reviewer roles, not current product status -->

**Prepared:** 2026-10-29. **State:** planned, not release-approved.

This is the executable successor to the requirements in the external `implementation_plan.md` referenced in the conversation. That file is not copied into the product or treated as validation evidence. The goal is a set of qualified, supported industrial workflows, followed by incremental expansion across all retained domains.

## 1. Execution architecture

| Role                         | Provider endpoint      | Actual model ID | Reasoning                | Agent                           |
| ---------------------------- | ---------------------- | --------------- | ------------------------ | ------------------------------- |
| Orchestrator and integrator  | Inception direct `/v1` | `mercury-3`     | `reasoning_effort: high` | `mercury-industrial-supervisor` |
| Engineering worker           | Inception direct `/v1` | `mercury-3`     | `reasoning_effort: high` | `mercury-industrial-worker`     |
| Separate specialist reviewer | Inception direct `/v1` | `mercury-3`     | `reasoning_effort: high` | `mercury-industrial-reviewer`   |
| Cross-domain corrective work | Inception direct `/v1` | `mercury-3`     | `reasoning_effort: high` | `mercury-industrial-corrector`  |

**Endpoint verification (2026-10-29):** official Inception model documentation
and examples use `https://api.inceptionlabs.ai/v1`; a read-only request to
`https://api.inceptionlabs.ai/api/v1/models` returned HTTP 404. The unverified
`/api/v1` entries from the initial plan draft are corrected above. All roles
remain explicitly pinned to Mercury 3 High through the single `inception-direct`
provider; role-specific endpoint separation is not a configured requirement.

The full model strings and raw request-body variants are in `opencode.industrial.json`. Agent prompts live under `.opencode/prompts/`. Every role is explicitly pinned; automatic provider substitution is forbidden. The opt-in config targets **OpenCode V2** and does not change an already running session's model.

The catalogs list Mercury 3 and Mercury 3 High. “High” and “Max” are reasoning settings, not model suffixes such as `mercury-3.0-high` or `mercury-6.0-max`. Catalog presence is not proof of authenticated access or inference success. Preflight must distinguish those states.

## 2. Baseline and immediate blockers

The previous conversation reported 791/792 assertions and 14/15 diagnostic passes. Those totals are **historical observations, not a fresh baseline for this plan**. Re-run after recording current changes. Source inspection already establishes these priority issues:

1. `test/vv/nafems/test_nafems_le1.js` runs a Lamé cylinder, `test_nafems_le10.js` a Kirsch plate, `test_nafems_le11.js` a cantilever, and `test_nafems_fv32.js` channel flow under standard-specific IDs. Verify every original specification; preserve the useful tests under accurate IDs and keep the intended named benchmark open until its actual problem is run.
2. `test/vv/references/hertz_contact_reference.js` declares `solverExecuted: false` and compares analytic Hertz output while reporting `HERTZ_CONTACT_3D`/“Discrete”. It cannot qualify a discrete contact solver. Generated sparse systems and an Euler–Bernoulli comparison similarly cannot stand in for an original NIST archive or Hannover experiment. Plate-thickness OPD does not establish ISO 10110 conformance.
3. `src/core/cae/fvm_navier_stokes_3d.js` replaces non-finite `kNew`/`omNew` with floors and uses `1 + dt * _dOm` despite `_dOm` being a quadratic sink, not the linearized sink coefficient. These are review targets, not evidence that RANS is complete. Reproduce the NASA failure and check signs, units, density scaling, full face topology, diffusion stability and boundary treatment before choosing a numerical remedy.
4. `test/vv/nasa_tmr/test_nasa_tmr_flat_plate.js` uses a coarse uniform mesh despite stretched-mesh capability existing. A passing number alone cannot establish stationarity, wall resolution or model fidelity.
5. `.github/workflows/ci.yml` makes the V&V step non-blocking. A production release gate cannot silently accept a known red physics test. Separate exploratory diagnostics from the enforced release manifest without hiding missing coverage.
6. Electron 34.5.8 is selected for this macOS 12 Intel laptop. Security posture and runtime support must be resolved; dependency classification does not eliminate the embedded runtime's advisories.
7. The known-limitations document still lists incomplete production routes, missing licensed property catalogs, unqualified workflows and unsupported external providers. A completed helper or unit test is not closure of these operations.
8. The generated P&ID has a reported 841-mm sheet height but prior schedule entries extend beyond it (for example, equipment y > 900 mm). Count/parse tests did not establish drawing completeness or clipping-free output. Inspect the actual exported sheets and workspace, not just element counts.

No generic “only one blocker left” conclusion is justified by this evidence.

## 3. Milestones and exit criteria

### M0 — Establish truthful release evidence (WS-01, WS-02, WS-23)

- Snapshot tracked and untracked state, toolchain, platform, configured providers, actual commands and exits. Preserve the current implementation.
- Build the capability matrix for all advertised operations, including unconditional unavailable routes, real engines and visible controls.
- Audit benchmark identity and standards edition/source/license. Give analytic/manufactured checks their own IDs; retain the target published cases as open until matched.
- Record all failing gates and unknown evidence. Fix exit-code masking and aggregate-NaN accounting; an assertion count must equal passed + failed.
- Exit: independently reviewed baseline and reference registry, no claims derived from substitute benchmarks, reproducible failure artifacts.

### M1 — Vertical product contract and durable workbench (WS-03, WS-20, WS-21)

- Standardize job inputs, explicit units, solver/backend/version, immutable input hash, project revision, events, cancellation, bounded resource use and result provenance.
- Route domain operations through reviewed adapters while retaining compatibility IPC methods. Use negative-path and contract tests to prevent silent drift.
- Complete project save/open/undo/redo and recovery with crash-injection and multi-archive isolation; opt-in WAL must be exercised by actual UI workflows.
- Exit: an end-to-end user workflow survives restart and failed jobs without losing inputs, stale results, or pending approvals. Every capability-matrix cell has a real path or a precise blocked reason.

### M2 — Numerical foundation and native integration (WS-04 through WS-11)

- Choose pinned, licensed mature backends by solver family; evaluate OCCT, a sparse direct library (e.g., SuiteSparse/MUMPS), meshing, and domain engines against the declared platform/ABI. Do not invent a library wrapper and call integration complete.
- Keep verified JavaScript implementations where they meet the validity/performance envelope. Native, Wasm, SIMD and GPU execution must be detected and proven by artifacts; hardware width and performance are measured, not marketing targets.
- Sparse SPD, nonsymmetric and indefinite problems require appropriate methods, pivoting, memory budgets and explicit dense-fallback bounds. “Out-of-core” requires real I/O and a working-set test exceeding RAM.
- Structural release cases require patch/objectivity/scaling tests, element quadrature, solver residuals, constitutive tangents, consistent mass/modal integration, contact convergence, and energy checks appropriate to the formulation.
- CFD work begins with conservative face topology, correct diffusion signs and scaling, pressure–velocity coupling, laminar verification, then the selected SST variant, mesh/stationarity/conservation studies and the original NASA setup. Retain the 4% tolerance where specified; do not tune to it.
- Explicit crash, VOF and turbomachinery methods stay labeled by their actual dimension and coupling. Build the requested higher-fidelity formulations as distinct supported operations.
- Exit: production adapters run the specified problems with recorded refinement/uncertainty, numerical failures are propagated, and performance fits the declared workstation/remote tier.

### M3 — CAD and specialized domain depth (WS-05, WS-06, WS-12 through WS-17)

- CAD: integrate an actual B-Rep kernel; validate manifold orientation, tolerances, features and history. STEP AP242 exchange requires external-reader round trips, product/assembly transforms, trims, units, PMI/layers/colors and schema validation. IGES is its own format; “IGES AP214” is not a valid target description.
- EDA: independently parsed Liberty/CCS data and DAG/MCMM timing, nonlinear SPICE with a real BSIM backend when required, and physical DRC/LVS/exchange tested on licensed/open reference sets. A square-law MOSFET or current-table demo is not foundry signoff.
- Optics: trace actual imported/material-defined systems, energy accounting, non-sequential branching, wave-optics FFT/MTF/PSF and tolerances with known validity. Source/license vendor catalogs before redistribution; permit customer-provided data through validated import.
- Plant: explicit mixtures/units and source-reviewed properties, PT/PH multiphase flash with material/fugacity/energy residuals, real simultaneous column solves, IF97 reference-state/region-boundary checks, transient hydraulics and piping under declared methods.
- Controls: distinguish stiff ODE integration from DAE support. Implement residual-form DAEs, consistent initialization/index limits, Stateflow semantics, FMU contracts and code generation with compiler/static-analysis/target-level evidence. Compliance is not guaranteed by emitting C text.
- Exit: operation-specific evidence, input schemas and product UI paths; unavailable licenses/providers are tracked dependencies, never filled with invented catalogs.

### M4 — Engineering workspace and P&ID product quality (WS-18, WS-19)

- Integrate editable/persisted P&ID documents, tags/nozzles, line/instrument/valve/loop schedules, revisions and off-page connectors. Use project basis values supplied or explicitly accepted by the engineer.
- P&IDs are schematic and ordinarily **not to scale**. A0 describes paper, not physical plant dimensions; remove unsupported physical-scale claims. Layout must paginate at bounded extents with cross-sheet connectivity.
- Validate all symbol/text/line extents against sheet and reserved title/legend areas, crossing/junction meaning, legibility at actual print size, tag uniqueness and schedule crossreferences. Add image-level/full-page review at multiple zoom/DPI sizes and print/PDF round trips.
- Engineering completeness includes safe-state annotations, drains/vents/sampling, relief destination and basis, isolation/maintenance, controls and cause/effect references as required by the approved design basis. Do not assume selected nominal pipe classes or PSV setpoints are adequate without ratings/sizing evidence.
- UI: selection/edit/undo, keyboard and accessibility, progress/error/empty states, stale-result guards, cancellation, consistent units, file dialogs, recovery, provenance inspection and export.
- Exit: domain engineer task-based acceptance on the packaged application, exact screenshot/build identity, no clipped objects or inert controls, saved/reopened document integrity.

### M5 — Operational and release assurance (WS-21 through WS-24)

- Real authenticated scheduler submission/polling/cancellation, SSH/TLS boundaries, least-privilege credentials, job-to-artifact provenance. Batch-script generation remains “prepared”, not “submitted”. Hardware signatures/timestamps require an actual injected/verifiable provider.
- Supported OS/runtime/security matrix, signed/notarized packages as applicable, cold-install and update/rollback evidence, SBOM/license review and supported dependencies.
- On this laptop: one heavy job at a time, bounded worker/memory use, UI p95 interaction latency target 100 ms for ordinary commands during compute, first meaningful startup target 5 s warm/10 s cold, eight-hour soak without unbounded memory growth. These are proposed targets; baseline and ratify them against representative projects before release.
- Enforce all required test/static/audit/V&V gates for the release scope; collect actual packaged smoke completion with exit zero. A survival timeout or “coverage floor pass” after a failed suite cannot close a gate.
- Build requirements→code→test→reference→artifact traceability and workflow-specific qualification dossiers. Use qualified independent reviewers for applicable engineering/regulatory claims.
- Exit: candidate manifest signed off by the responsible product/domain/security owners; unresolved critical/high issues and in-scope capability gaps block production release.

## 4. Parallel organization

`workstreams.json` lists 24 specialist lanes and prerequisites. Multiple isolated Mercury worker sessions can serve those lanes. The supervisor supplies exact paths per task after inspecting the tree; listed candidate paths are not blanket concurrent write grants.

- 2 writing workers + 1 separate reviewer at a time on the current laptop; 1 heavy job/build; queue additional lanes.
- One owner for shared files and dependency changes. Freeze writes before full tests/coverage/packaging.
- Per task: baseline → scoped design → meaningful implementation → focused tests → independent Mercury review → Mercury reproduction/correction → integration gates → evidence-ledger update.
- If credentials, rate limits, licensed references, external infrastructure or runtime support block work, finish independent tasks and record that dependency. Do not claim completion or endless background execution.

## 5. Acceptance evidence template

```text
Task/workflow and supported domain:
Requirement IDs and baseline revision/input hashes:
Actual provider/model/session identities:
Changed paths and production call path:
Method, units, assumptions and validity bounds:
Reference publisher/edition/license/SHA-256:
Predeclared metrics/tolerances and uncertainty:
Measured result/residual/conservation/refinement:
Commands, cwd, environment, exit codes and artifacts:
UI/edit/save/reopen/export/cancel/failure results:
Runtime, memory, throughput and backend measurements:
Independent review findings and correction evidence:
Gate status and unresolved blockers:
Release authorization (external to agent self-assessment):
```

## 6. Definition of finished

“Finished” is the accepted release manifest for declared workflows and operating envelopes, with independently reviewed evidence and supported deployment. Retain all existing domains; qualify each before extending release approval to it. A universal 10/10, a finite number of tests, or an AI-generated dossier cannot demonstrate unlimited engineering scope or confer legal certification.

## 7. Configuration references checked

- Inception models and high reasoning: https://docs.inceptionlabs.ai/get-started/models.md
- Inception catalog: https://api.inceptionlabs.ai/v1/models
- Inception reasoning efforts: https://docs.inceptionlabs.ai/capabilities/reasoning-efforts.md
- Harness schema: https://opencode.ai/config.json
- V2 providers/variants: https://opencode.ai/v2/docs/providers/
- V2 agent model selection: https://opencode.ai/v2/docs/agents/

These establish configuration syntax and advertised capabilities, not authenticated execution or product readiness.
