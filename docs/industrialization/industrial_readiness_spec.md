# OmniEng Industrial Readiness Specification v1

<!-- claims:evidence:OMN-IND-SPEC-001 vocabulary-gate definitions and role/matrix/rubric definitions; this document is the controlling policy for claim language, not a product status claim -->

| Field      | Value                                   |
| ---------- | --------------------------------------- |
| Document ID | OMN-IND-SPEC-001                       |
| Version    | 1.0.0                                  |
| Date       | 2026-10-30                             |
| Document class | Internal engineering specification — release-gating policy |
| Status     | Approved for use by the R0 industrialization campaign |

Scope: all 12 registered engineering domains (cad, cae, cfd, controls, eda,
optics, plant, cam, aerospace, pdm, hpc, robotics) plus six cross-cutting
disciplines (software assurance, security, packaging, certification,
interoperability, governance). The specification defines how readiness is
measured, how claims may be worded, who decides, and what evidence a release-go
requires. It does not by itself release anything; all domains remain on the R0
train and are **experimental, not release-approved** until the gates in §4 pass.

---

## 1. Registered domains

The 12 registered domain adapters are read from `src/core/contracts/engine_registry.js`;
maturity defaults come from `src/core/maturity/feature_maturity.js`
(`state: 'experimental'`, `releaseApproved: false` for every domain unless a
release-go has been recorded).

| # | Domain ID | Adapter | Representative routes |
| - | --------- | ------- | --------------------- |
| 1 | cad | GeometryEngineAdapter | NURBS surface evaluation; sampled SSI intersection; mesh boolean/edge-blend helpers; assembly mates; 2D variational sketching; STEP AP214 text export |
| 2 | cae | FEAEngineAdapter | caller-mesh 3D linear-elastic FEA (HEX20/TET10); Timoshenko beam; simplified drop-test estimate; 2D transient conduction |
| 3 | cfd | CFDEngineAdapter | 3D FVM Navier–Stokes k-omega SST; HLLC/Roe/AUSM fluxes; VOF helper; sliding-mesh turbomachinery route unavailable |
| 4 | controls | ControlsEngineAdapter | state-space LTI simulation/discretization; CARE/DARE LQR; EKF estimate; MPC active-set QP; Bode from caller transfer-function coefficients |
| 5 | eda | EDAEngineAdapter | SPICE DC nodal; MCMM STA; logic synthesis; place-and-route; rectangle DRC; GDSII/OASIS subset serialization; parasitic estimation |
| 6 | optics | OpticsEngineAdapter | sequential/non-sequential Snell–Fresnel ray tracing; Sellmeier dispersion; FFT PSF/MTF/OPD; thin-film transfer-matrix coating |
| 7 | plant | PlantEngineAdapter | IAPWS-IF97 regions 1/2/4/5; Peng–Robinson + Rachford–Rice flash; TEMA rating; pinch targets; water-hammer MOC; piping-stress helpers |
| 8 | cam | CAMEngineAdapter | 3-axis constant-Z planar roughing toolpaths; illustrative ISO/Fanuc-style G-code text |
| 9 | aerospace | AerospaceEngineAdapter | rocket propulsion/combustion/staging estimates; ascent-trajectory estimate; Hohmann/bi-elliptic transfer delta-v; cooling/turbopump/isogrid helpers; shock-expansion estimate |
| 10 | pdm | PDMEngineAdapter | caller-supplied eBOM roll-up; lifecycle-rule validation; CAD revision geometry-diff heuristic; RBAC/signature/vault unavailable |
| 11 | hpc | HPCEngineAdapter | in-memory RCB point partitioning; local worker-pool dispatch; SLURM/PBS script templates (submission/remote execution unavailable); caller-assumption storage-use estimate |
| 12 | robotics | RoboticsEngineAdapter | 6-DOF/7-DOF DH and PoE forward kinematics; damped least-squares inverse kinematics; recursive Newton–Euler; quintic trajectory planning; URDF parsing |

---

## 2. Domain-by-domain standards matrix

Terminology for the matrix columns:

- **Standards / reference frameworks** — the named standards, benchmarks, or
  published reference families whose applicability holds for the domain's
  advertised routes. Naming a standard here is **not** a conformance claim.
- **Current posture (2026-10-30)** — the recorded evidence-lite state for the
  advertised routes, drawn from `docs/industrialization/status.md`,
  `docs/industrialization/capability_matrix.md`,
  `docs/industrialization/reference_registry.md`, and
  `docs/known_limitations.md`.
- **Release-go evidence (minimum)** — what must be true, and recorded, before
  the domain may carry a release-approved designation; see §4.

### 2.1 Domain matrix

| Domain | Standards / reference frameworks | Current posture (2026-10-30) | Release-go evidence (minimum) |
| ------ | -------------------------------- | ---------------------------- | ----------------------------- |
| cad | ISO 10303-21 (STEP physical file); ISO 10303 AP214/AP242 exchange; ISO 10303-42 geometry resources | Experimental geometry adapter with limited routes; STEP export is a serialized text subset with no independent-reader round trip; no B-rep validity proof | STEP round trip against an independent external reader passes on a reference assembly; B-rep validity invariants recorded (manifold, watertight) for the advertised operations; no geometry claim exceeds the recorded route coverage |
| cae | NAFEMS LE1/LE10/LE11 benchmarks; ASME V&V 10; ASTM E1049 (fatigue) | Linear-elastic caller-mesh FEA and beam routes exercise production solvers; NAFEMS original cases remain unavailable by user decision; independent validation pending | At least one named benchmark (NAFEMS or a licensed equivalent) runs through a production adapter and passes its declared tolerance; a grid-convergence study is recorded; an independent assessor reviews the evidence |
| cfd | NASA TMR flat-plate (Kármán–Schoenherr); NAFEMS FV32; AIAA best-practice verification | NASA TMR comparison FAILS: stationarity gate passes, skin-friction error 28.3% vs 4% tolerance; FV32 unavailable; SIMPLE/VOF coupling absent | NASA TMR flat-plate passes the predeclared 4% tolerance after a recorded grid-convergence study; or an alternative external benchmark accepted by the assessor passes; no turbulence-model claim exceeds the tested regime |
| controls | IEC 61508 / ISO 26262 (only where a safety application is claimed); ISO 9001 development practices | State-space, LQR, EKF, MPC, and Bode routes are experimental; no hardware-in-the-loop or real-time assessment | Reference plant models reproduce published closed-loop responses within declared tolerance; stability and margin results are reported with their assumptions; any functional-safety claim is gated by the applicable dossier |
| eda | SEMI P39 (OASIS); GDSII format baseline; foundry PDK integration; BSIM4 compact models | Narrow layout subset; OASIS conformance unverified; GDSII comparison is a size estimate; no PDK/Liberty cells bundled; BSIM4 model unavailable | DRC/LVS/STA suites on reference designs pass with a recorded positive-and-negative set; format round trips verified against independent readers; foundry conformance required before signoff-language is used |
| optics | ISO 10110 (tolerancing); Sellmeier dispersion conventions; Zemax import format | Ray tracing, PSF/MTF/OPD, and thin-film routes are experimental; glass catalog empty; RCWA unavailable; ISO 10110 reference case unavailable | An ISO 10110-style tolerance analysis on a prescription with reviewed glass data; comparison of a reference design against an independent optical tool; catalog items carry source/license records |
| plant | IAPWS-IF97 regions 1/2/4/5; ASME B31.3/B31.4; TEMA; AIChE DIPPR | Region 1/2/4/5 property checks exercise production code; DIPPR database absent; piping helpers are estimates and not code assessments | IAPWS-IF97 properties verified against published values at region boundaries; flash validated against a published phase envelope; any code-assessment claim requires the assessment workflow and assessor review described in §4 |
| cam | ISO 6983 (G-code lexical style); ISO 14649 (STEP-NC); machine-kit postprocessors | Roughing toolpaths and illustrative G-code text only; no postprocessor validation, NC simulation, or collision checking | Toolpath verified on a reference stock (removal/containment checks); postprocessor output validated on a target-controller simulator; machine-motion claims limited to the verified kinematic envelope |
| aerospace | DO-178C / DO-330 (airworthiness software); ARP4754A; AIAA S-102 | Rocket/combustion/staging estimate routes are experimental; 6-DOF/VLM/flutter/J2/Lambert absent; DO-330/ISO 26262 dossiers are NOT YET CERTIFIED | A propulsion/performance case reproduces a published reference within declared tolerance; trajectory propagation verified against an independent integrator; any DO-178C/DO-330-adjacent assertion is bound to a certified dossier |
| pdm | ISO 10303 AP242 (managed model-based 3D); ISO 10007 (configuration management) | Caller-supplied BOM roll-up, lifecycle-rule validation, and revision-diff heuristic; no persistent revision state machine, RBAC/signatures, ECO workflow, or vault | eBOM roll-up verified against an independent calculator on reference hierarchies; revision-diff semantics verified on known-change cases; configuration-management features gated by separate evidence |
| hpc | MPI-4; SLURM/PBS job scheduling; out-of-core I/O practice | In-memory RCB partitioning; local worker pool; scheduler script templates only; no remote submission/poll/cancel; storage-use estimate uses caller assumptions | Partitioning satisfies recorded balance/size invariants; remote schedule/submit/poll/cancel verified end-to-end on a sandbox cluster; storage estimates carry assumption records and no out-of-core claim beyond tested I/O |
| robotics | ISO 10218-1/-2 (robot safety); URDF 1.0; DH convention | Kinematics/dynamics/planning routes are experimental; URDF records without inertial or limit data are incomplete; no safety assessment | Kinematics verified against a known serial-chain geometry (position/orientation within declared tolerance); inverse-kinematics reachability checks documented; any robot-safety statement requires an ISO 10218 assessment |

### 2.2 Cross-cutting matrix

| Discipline | Standards / reference frameworks | Current posture (2026-10-30) | Release-go evidence (minimum) |
| ---------- | -------------------------------- | ---------------------------- | ----------------------------- |
| Software assurance | ISO/IEC 12207 / ISO 15288 life-cycle; DO-330 tool qualification; ISO 26262-8 §11 | DO-330 and ISO 26262 dossiers exist as honest gap dossiers; tool qualification status is NOT YET CERTIFIED; no released verification service configured | Life-cycle roles and artifacts recorded for each released domain; any tool-qualification claim is bound to a certified dossier; verification service dependencies are documented, not invented |
| Security | OWASP ASVS; NIST SP 800-218 (SSDF) | Dependency audit reports 0 vulnerabilities; renderer hardening partial (context isolation, sandbox, no inline scripts; inline styles still allowed); packages unsigned/not notarized; threat model preliminary; no penetration test | Threat model reviewed for each released domain; dependency audit clean; signed/notarized distribution where distribution claims are made; penetration/security matrix results recorded; no high/critical findings open |
| Packaging | electron-builder conventions; platform minimums | macOS 13+ directory build succeeds; ASAR excludes tests/scripts and byte-matches runtime files; SBOM (CycloneDX/SPDX) regenerated; package unsigned and never launched on a supported host; license ISC vs EULA decision pending | Cold-install, launch, update, and rollback verified on each supported OS; artifacts signed/notarized per distribution policy; SBOM and notices in sync with the lockfile; license/EULA recorded |
| Certification | RTCA DO-330; ISO 26262; ASME Section VIII Div 2 | Dossiers and qualification kit are non-claiming (`certificationClaimed: false`); ASME helpers emit no certificates; NOT YET CERTIFIED statements are explicit | Any "certified" or "certification" language appears only when the referenced certificate/dossier is recorded and current; otherwise the NOT YET CERTIFIED wording remains mandatory |
| Interoperability | ISO 10303 AP214/AP242; SEMI P39; GDSII; CGNS/FMI candidate formats | STEP AP214 internal self-round-trip only; OASIS subset unverified; GDSII compare is a size estimate; FMI master route unavailable; ZMX import preserved; IPC/preload surfaces versioned | Advertised format routes have external-reader round-trip or golden-artifact comparisons; FMI/other interoperability claims require end-to-end tool-chain evidence |
| Governance | ADR process; release trains; evidence ledger; claims-language gate | ADR-0001/0002/0003 recorded; R0 train active; evidence ledger maintained; hosted CI absent; no rights-holder license/EULA decision; no release-owner signoff | License/EULA decision recorded; release-candidate manifest signed by owner, QA (evidence), and assessor (assessment); claims-language gate green; hosted CI results present for released platforms |

---

## 3. Tolerance & claims policy

### 3.1 Vocabulary gates

The following terms are **banned in positive, unguarded form** anywhere in
user-facing or controlled engineering prose:

| Banned term | Examples of the forbidden positive use |
| ----------- | -------------------------------------- |
| certified | "This solver is certified for X" |
| validated | "The workflow is validated" |
| qualified | "A qualified production adapter exists" |
| conforms to | "The file conforms to ISO 10303-21" |
| compliant with | "The tool is compliant with SEMI P39" |
| production-ready | "The module is production-ready" |
| release-approved | "The domain is release-approved" |

A term is considered **used positively** when it appears as an asserted
property of the product, a module, a route, or an artifact without any of the
escapes in §3.2.

### 3.2 Allowed uses

The banned terms may be used only in one of these forms:

1. **With an evidence reference.** The file containing the claim carries a
   whitelist marker binding the language to a recorded evidence artifact:
   - in Markdown: `<!-- claims:evidence:<ref> -->`;
   - in JavaScript: `// claims:evidence:<ref>`.
   `<ref>` must name a dated, recorded artifact (evidence-ledger entry,
   checkpoint, command output, or code reference with line numbers). The
   marker does not grant capability; it binds the claim to recorded evidence
   that the responsible owner and QA can reproduce.
2. **In negation.** The mis is denied explicitly and immediately.
   Examples: "NOT YET CERTIFIED", "not release-approved", "has not been
   validated", "unqualified", "no qualified production adapter is configured",
   "does not conform to ISO 10303-21".
3. **In fixed definitional or requirement frames** that are not assertions of
   product status: protocol vocabulary definitions ("separate …, validated,
   release-approved, and certified"), requirement statements ("requires a
   separately implemented and validated backend"), and role descriptors
   ("qualified counsel", "qualified independent reviewers").

### 3.3 Enforcement

- `scripts/check_claims_language.js` scans `src/**/*.js`, `main.js`,
  `preload.js`, and `docs/**/*.md`. It prints `file:line:match` for each
  positive unguarded use and exits 1; a clean run prints
  `claims-language gate: PASS` and exits 0.
- The gate is a release gate: a red run blocks any release-go signoff.
- A whitelist marker may be added only when the claim is legitimate and backed
  by the recorded evidence; markers must be adjacent to existing content and
  must not alter existing wording.
- The gate ignores metadata identifiers (e.g. `releaseApproved: false`,
  `certificationClaimed: false`), URLs, and vendored/third-party bundles
  (`src/vendor`, `src/public`), matching the repository's ESLint/Prettier
  ignore conventions.

### 3.4 Examples

| Sentence | Gate result |
| -------- | ----------- |
| "The domain is release-approved." | violation — positive, unguarded |
| "The domain is not release-approved." | allowed — negated |
| "Certified per DO-330 dossier OMN-IND-CERT-LEDGER-001." | allowed — file carries `<!-- claims:evidence:... -->` binding the dossier |
| "The solver is NOT YET CERTIFIED." | allowed — negated |
| "The table is validated for finiteness." | allowed in `docs/industrialization/status.md` — evidence marker binds the recorded PCG validation behavior |
| "Full config validated against the published OpenCode schema." | allowed in `docs/industrialization/mercury_inception/SETUP_VERIFICATION.md` — evidence marker binds the recorded command result |

---

## 4. Roles and release-go

### 4.1 Roles

| Role | Duties | Authority | Independence |
| ---- | ------ | --------- | ------------ |
| **Domain Owner** | Maintains the domain's route truth in the capability matrix; curates the evidence pack (references, runs, tolerances, limitations); prioritizes remediation; prepares the release-candidate manifest for the domain | Signs the owner attestation for a release-go; cannot approve by themselves | May be the route author |
| **QA / Verification** | Runs and records the gates (tests, claims language, syntax, coverage, packaging, dependency audit) with dates and environments; checks reproducibility; enforces fail-closed behavior; maintains the evidence ledger | Certifies that evidence artifacts are real and reproducible; does not grant release approval | Must not be the sole author of the artifact under assessment |
| **Assessor** | Independently evaluates the domain against §2 and the §5 scorecard; compares claims to evidence; issues assessment memos; checks that banned vocabulary is not used positively without evidence | Required co-signer for release-go; may block on unmet evidence | No edit rights in the assessed domain; must not be the owner or author of the assessed material |

### 4.2 Release-go definition

A domain may be designated **release-approved** only when a recorded release-go
checklist for that domain is all-green:

1. **Claims-language gate:** `node scripts/check_claims_language.js` exits 0;
   every positive banned-term use carries an evidence marker binding a recorded
   artifact.
2. **Capability matrix truth:** every advertised capability row for the domain
   is `yes: source-verified` or an explicit, recorded gap; no invented or
   unwired routes appear.
3. **No failing diagnostics:** the V&V suite for the domain has no FAIL rows;
   UNAVAILABLE rows are documented with the missing resource.
4. **Domain-specific evidence:** the minimum evidence in the §2 matrix
   rightmost column is recorded, reproducible, and assessor-reviewed.
5. **Security and packaging gates:** dependency audit clean; supported-OS
   launch/update/rollback evidence exists where the domain is distributed;
   signing/notarization policy satisfied for distribution claims.
6. **Compliance discipline:** any certification-adjacent language is bound to
   a current certificate/dossier; otherwise NOT YET CERTIFIED wording remains.
7. **Governance:** license/EULA decision recorded; evidence ledger updated;
   release-candidate manifest signed by the owner, QA, and assessor.
8. **Scorecard floor:** no scorecard dimension for the domain scores below the
   floor in §5.4, and the weighted total meets the band required for the
   intended release channel (see §5.5).

A score alone never releases a domain; the checklist is the decision vehicle.

---

## 5. Scorecard rubric

### 5.1 Dimensions and weights

| # | Dimension | Weight |
| - | --------- | -----: |
| 1 | Solver validation | 20 |
| 2 | Domain breadth | 10 |
| 3 | Software quality | 15 |
| 4 | Verification depth | 12 |
| 5 | Security | 10 |
| 6 | Reliability / ops | 8 |
| 7 | Packaging / distribution | 8 |
| 8 | Compliance / certification | 10 |
| 9 | Interoperability | 4 |
| 10 | Governance / licensing | 3 |
| | **Total** | **100** |

The weights reflect R0 priorities: numerical credibility and verification
depth dominate because they are the weakest and most safety-relevant areas;
breadth, packaging, and governance carry smaller weights because they are
structural rather than correctness-critical.

### 5.2 Score anchors (0–5 per dimension)

| Score | Meaning |
| ----: | ------- |
| 5 | Complete evidence package: independent review, production-quality artifacts, all sub-gates pass, no open blocking gaps |
| 4 | Strong evidence: all core gates pass; minor documented gaps without blocking status |
| 3 | Evidence exists but gaps are documented; some references pending or substitutes used with honest labels |
| 2 | Partial evidence; assumptions stated; no independent review |
| 1 | Exploratory artifacts; claims largely unsupported |
| 0 | Absent |

### 5.3 Dimension definitions

1. **Solver validation** — named-reference agreement, convergence/refinement
   studies, uncertainty records, failure propagation, reproducibility.
2. **Domain breadth** — number of registered domains with real, wired,
   source-verified routes; gap cells precisely motivated.
3. **Software quality** — static gates (lint, typecheck, syntax, IPC
   registration, renderer-sink inventory, formatting), coverage, test
   discipline, code-preservation audits.
4. **Verification depth** — V&V diagnostics exercised against the actual
   production routes; deterministic replay; percent of named references
   available versus total.
5. **Security** — dependency audit, renderer/injection defenses, threat
   modeling, secret scan, signing/notarization posture, penetration status.
6. **Reliability / ops** — performance budgets, hosted CI results, soak and
   p95-latency measurements, scheduler/worker-pool behavior, recovery.
7. **Packaging / distribution** — reproducible builds, artifact contents,
   SBOM/notices, platform coverage, installer/update/rollback evidence.
8. **Compliance / certification** — dossier status, certification-adjacent
   claim discipline, external reviewer/regulatory engagement.
9. **Interoperability** — external-reader round trips, format conformance
   evidence, import/export parity, tool-chain integration.
10. **Governance / licensing** — ADR/decision records, release-train
    discipline, evidence-ledger maintenance, license/EULA resolution,
    claims-language gate enforcement.

### 5.4 Interpretation bands

| Weighted total | Band | Meaning |
| -------------: | ---- | ------- |
| 0–24 | Exploratory | research-grade artifacts; no release channel |
| 25–49 | Experimental | current R0 posture; usable for development and evaluation, not release |
| 50–74 | Industrial pilot | suitable for controlled pilot deployments with documented limits |
| 75–89 | Industrial candidate | meets most gates; final review and residual items before release |
| 90–100 | Release candidate | score supports release, but the §4.2 checklist still decides |

Platform of 3 per dimension (weighted floor): any dimension at 0 blocks the
release-go regardless of total.

### 5.5 Relationship to release-go

The scorecard is the working measurement instrument; the §4.2 checklist is the
decision authority. A high score with an open checklist item (for example a
FAIL V&V diagnostic or a red claims-language gate) does not release anything.

---

## 6. Record keeping

- Every gate result referenced by this specification is recorded with its date,
  command, environment, and exit code in
  `docs/industrialization/status.md` and the evidence ledger
  `docs/industrialization/certification/evidence_ledger.md`.
- The claims-language gate itself is enforced by
  `scripts/check_claims_language.js` and covered by
  `test/test_claims_language_gate.js`.
- Changes to this specification are versioned; a revision increments the
  version field and records the change reason in the status document.

_End of specification._
