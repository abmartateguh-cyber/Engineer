# Certification Readiness Package — OmniEng Engineering Tool Suite

| Field          | Value                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| Document ID    | OMN-IND-CERT-PKG-001                                                      |
| Version        | 0.1.0                                                                     |
| Date           | 2026-10-30                                                                |
| Document class | Readiness package index — **not** a certificate, approval, or safety case |
| Status         | **NOT YET CERTIFIED**                                                     |

## 1. Purpose

This package indexes the evidence currently assembled for a future assessor
submission of the OmniEng engineering tool suite ("the Tool") under RTCA
DO-330 (provisional TQL-5 target) and ISO 26262:2018 (provisional
TCL1/ASIL-D target). It is a **readiness index**, not a certification,
qualification, or independent assessment. It points to the dossiers, the
evidence ledger, and the verification artifacts whose state is recorded there.

Everything referenced here remains experimental; the Tool remains **NOT YET
CERTIFIED** under both frameworks.

## 2. Submission checklist

| #   | Item                                                      | Artifact                                                                                                                                        | Status at 2026-10-30                                                                                       |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | This readiness package (index)                            | `docs/industrialization/certification/certification_ready_package.md`                                                                           | Present                                                                                                    |
| 2   | DO-330 dossier                                            | `docs/industrialization/certification/do330_tql_dossier.md`                                                                                     | Present; draft; NOT certified                                                                              |
| 3   | ISO 26262 dossier                                         | `docs/industrialization/certification/iso26262_safety_case.md`                                                                                  | Present; draft; NOT certified                                                                              |
| 4   | Evidence ledger                                           | `docs/industrialization/certification/evidence_ledger.md`                                                                                       | Present; local diagnostics only                                                                            |
| 5   | Static, coverage, and performance gates                   | syntax, lint, typecheck, formatting, IPC registration, renderer sinks, dependency audit, SBOM, Poisson budget, coverage floor (see dossiers §6) | Verified 2026-10-30 locally                                                                                |
| 6   | Remaining-module coverage suite                           | `test/test_coverage_remaining_modules.js`                                                                                                       | Present; 17/17 passed                                                                                      |
| 7   | MMS grid-convergence suite                                | `test/test_mms_grid_convergence.js`                                                                                                             | Integrated artifact — to be verified (file not present; required by REQ-007/REQ-011)                       |
| 8   | Claims-language gate                                      | `test/test_claims_language_gate.js`; `scripts/check_claims_language.js`                                                                         | Present; gate FAILED 2026-10-30 (17 findings across 8 files); triage pending                               |
| 9   | Requirements-coverage / traceability gate and mapping     | `test/test_requirements_coverage.js`; `scripts/check_requirements_coverage.js`; `docs/industrialization/requirements_traceability.md`           | Present; verified 2026-10-30 — PASS (40 requirements, 33 IMPLEMENTED, 0 missing; 2 non-fatal MMS warnings) |
| 10  | Determinism check                                         | `scripts/check_determinism.js`                                                                                                                  | Present; verified 2026-10-30 — PASS                                                                        |
| 11  | Secret-pattern scan                                       | `scripts/check_secret_patterns.js`                                                                                                              | Integrated artifact — to be verified (file not present)                                                    |
| 12  | Industrialization readiness spec and CI matrix            | `docs/industrialization/industrial_readiness_spec.md`; `docs/industrialization/ci_matrix.md`                                                    | readiness spec to be verified (file not present); CI matrix present, no hosted execution                   |
| 13  | Independent assessor engagement and external dependencies | Section 4                                                                                                                                       | Open                                                                                                       |

## 3. Evidence map

### 3.1 DO-330 (provisional TQL-5 target)

| Claim area                | Artifact(s)                                                                                                                           | Evidence date      | Status                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Dossier and status        | `do330_tql_dossier.md`                                                                                                                | 2026-10-30 refresh | Draft; **NOT YET CERTIFIED**; TQL-5 provisional                                                                        |
| Master suite              | `test/run_all_tests.js`; `scripts/run_tests_clean.js`                                                                                 | 2026-10-31         | 870/871 passed; 1 failed (NASA TMR, fail-closed); V&V runner 10 pass / 0 unavailable / 5 fail                          |
| Static gates              | `scripts/check_syntax.js`, `scripts/check_ipc.js`, `scripts/check_renderer_sinks.js`, ESLint, `tsc`, Prettier, `npm audit`, SBOM      | 2026-10-31         | syntax 372/372; lint/typecheck/format clean; IPC 174/174; renderer sinks 2/32/16/1; audit 0 vulnerabilities            |
| Coverage floor            | `npm run coverage` (`scripts/run_coverage.js`; `scripts/coverage_threshold.js`)                                                       | 2026-10-31         | function 3,520/3,610 (97.5%) and line 72,741/75,051 (96.9%) above the 85% floors; branch proxy 68.9% FAIL vs 85% floor |
| Validation / V&V          | `test/vv/run_vv.js`; `npm run report:vv`                                                                                              | 2026-10-31         | 10 pass / 0 unavailable / 5 fail (NASA TMR, CHANNEL, NAFEMS LE1/LE11/T1; fail-closed)                                  |
| Remaining-module coverage | `test/test_coverage_remaining_modules.js`                                                                                             | 2026-10-30         | 17/17 passed                                                                                                           |
| MMS grid-convergence      | `test/test_mms_grid_convergence.js`                                                                                                   | —                  | Integrated artifact — to be verified (file not present; required by REQ-007/REQ-011)                                   |
| Claims-language gate      | `test/test_claims_language_gate.js`; `scripts/check_claims_language.js`                                                               | 2026-10-30         | Present; gate FAILED (17 findings across 8 files); triage pending                                                      |
| Traceability gate         | `test/test_requirements_coverage.js`; `scripts/check_requirements_coverage.js`; `docs/industrialization/requirements_traceability.md` | 2026-10-30         | Present; verified — PASS (40 requirements, 33 IMPLEMENTED, 0 missing; 2 non-fatal MMS warnings)                        |
| Determinism check         | `scripts/check_determinism.js`                                                                                                        | 2026-10-30         | Present; verified — PASS (capability matrix byte-identical; PRNG replay identical)                                     |
| Secret-pattern scan       | `scripts/check_secret_patterns.js`                                                                                                    | —                  | Integrated artifact — to be verified (file not present)                                                                |

### 3.2 ISO 26262:2018 (provisional TCL1 / ASIL-D target)

| Claim area                             | Artifact(s)                                                                                                       | Evidence date      | Status                                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dossier and status                     | `iso26262_safety_case.md`                                                                                         | 2026-10-30 refresh | Draft; **NOT YET CERTIFIED**; TCL1/ASIL-D provisional                                                                                                                  |
| Master suite / static / coverage / V&V | same evidence as §3.1 (shared runs)                                                                               | 2026-10-30         | as §3.1; local diagnostics only, not qualified confidence measures                                                                                                     |
| Confidence-measure harnesses           | remaining-module coverage (17/17); MMS grid-convergence; claims gate; traceability gate; determinism; secret scan | 2026-10-30         | remaining-module verified 17/17; determinism PASS; traceability PASS (40 req, 33 IMPLEMENTED); claims gate FAILED (triaging pending); MMS + secret scan to be verified |
| Safety-claim review                    | —                                                                                                                 | —                  | Not performed; no claims–argument–evidence structure exists                                                                                                            |

## 4. Open external dependencies

1. **Apple signing.** macOS distribution requires Apple Developer code-signing
   and notarization. Current builds carry valid ad-hoc code signing
   (`codesign -s -`, `codesign --verify --deep --strict` exit 0); the packaged
   app was launched locally on host macOS 12.7.6 with `--test-ui` and exited 0.
   No Developer ID identity is installed, so signed/notarized distribution
   remains open.
2. **Hosted CI.** The repository has no configured remote and no hosted CI
   results. The declared OS matrix (Ubuntu 22.04/24.04, Windows 2025 x64,
   macOS 15 x64/arm64) is unexecuted; all evidence is local (darwin-x64).
3. **Licensed datasets.** The named reference cases that would strengthen
   validation (NAFEMS, original NIST archive, Hannover, ISO 10110) require
   licensed or publisher-approved data. The core `VVRegistry` returns
   UNAVAILABLE for those slots pending license acquisition.
4. **Assessor engagement.** No independent assessor, certification body, or
   employer-designated qualification body has been engaged, and none has
   reviewed any dossier or evidence item in this package.

## 5. Statement

This package is a **readiness package, not a certification**. Nothing in it —
including the dossiers, the ledger, the counters, or the harness references —
grants a qualification level, an airworthiness or functional-safety approval,
or any certification/tool credit. The Tool remains **NOT YET CERTIFIED**
under DO-330 and ISO 26262 until a competent authority or assessor accepts
completed evidence, which in turn requires resolving the open dependencies in
Section 4 and final verification of the to-be-verified artifacts listed
above.

---

_End of readiness package index. Prepared as an honest evidence index; it
deliberately claims no certification._
