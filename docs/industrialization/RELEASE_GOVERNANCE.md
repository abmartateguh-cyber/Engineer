# OmniEng Release Governance Framework

<!-- claims:evidence:RELEASE_GOVERNANCE.md process framework; "qualified" appears only as a defined channel/role category label, not a product-status claim -->

Document class: internal governance framework — planning and process reference, not legal advice, not a license, and not a release authorization.

Applies to: OmniEng ("the Product"), release train R0 (current), and all subsequent trains.

Updated: 2026-10-30.

---

## 1. Scope and authority

This framework governs how the Product moves from experimental workbench toward industrial release. It does **not** approve any release. No release is authorized until (a) the responsible product/domain/security owners sign the release manifest (see §7), (b) the release-go checklist for the release type is fully satisfied, and (c) the rights-holder license/EULA decision is recorded (§2).

Current posture: all registered domains remain experimental and not release-approved (ADR-0001). The NASA TMR flat-plate validation case fails honestly. Hosted CI has no results, packaged-app launch/update/rollback is unverified, and the license/EULA decision is pending (ADR-0003).

---

## 2. License / EULA decision record

### 2.1 Current verified state (2026-10-30)

| Item                         | Verified state                                                                           | Evidence                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `package.json` license field | `ISC` (inherited, unverified for distribution)                                           | `package.json` (line 44)                                                    |
| Root `LICENSE` text          | Absent                                                                                   | repository root                                                             |
| Product EULA                 | Absent (draft pending rights-holder review)                                              | `docs/industrialization/EULA_DRAFT.md`                                      |
| Rights holder                | `author: "OmniEng Engineering Systems"` in `package.json`; true legal owner NOT verified | `package.json`; ADR-0003                                                    |
| ADR                          | ADR-0003 "Product license and EULA require rights-holder review" — status Pending        | `docs/industrialization/decisions/ADR-0003-license-eula-pending.md`         |
| Third-party notices          | Present; documents dependencies, not Product ownership                                   | `docs/third_party_notices.md`, `docs/industrialization/packaging_report.md` |

**Standing rule:** package metadata is unverified for distribution until the rights holder records a decision. The `ISC` field remains unchanged pending review. No operative license text is invented without authorization.

### 2.2 Decision form (to be completed by the rights holder)

Record one decision per Product line and version range. A filled form becomes a decision record; the governance tracker keeps a log (§2.3).

```text
DECISION FORM — OMNIENG LICENSE / EULA
---------------------------------------
Record ID:            LIC-DEC-YYYY-MM-DD-NNN
Date:                 [date]
Decision maker:       [name/title of rights holder or authorized delegate]
Authority verified:   [how authority to license was verified]

1. Product version range: [e.g. 1.0.0 — current experimental build]
2. Source license (distribution of source): [ISC / MIT / Apache-2.0 / proprietary / other]
3. Runtime/end-user license (EULA): [proprietary EULA / OSS / none yet / other]
4. Distribution model: [free / paid / SaaS / internal-only / mixed]
5. Redistribution rights: [granted / withheld / conditional]
6. Third-party redistribution review status: [complete / pending / blocked — reason]
7. Signing/notarization requirements: [required / waived for experimental channel]
8. Effective date: [date]
9. Approved text attachments: [links to approved LICENSE and EULA files]
10. Remaining open items: [list]

Decision:  [APPROVED / APPROVED WITH CONDITIONS / REJECTED / DEFERRED]
```

### 2.3 Decision log

| Record ID                         | Date       | Decision                                 | License chosen       | Status | Evidence |
| --------------------------------- | ---------- | ---------------------------------------- | -------------------- | ------ | -------- |
| LIC-DEC-2026-10-24-001 (ADR-0003) | 2026-10-24 | DEFERRED — rights-holder review required | none (ISC unchanged) | OPEN   | ADR-0003 |

---

## 3. Support SLA template

Support tiers are **not yet operational**. This template defines what an SLA record must contain once support is offered. Until a release is signed and support owners are named, no support commitment exists.

```text
SLA TEMPLATE — OMNIENG SUPPORT
--------------------------------
SLA ID:               SLA-YYYY-MM-DD-NNN
Product version:      [semver range]
Support tier:         [Tier 1 — community/best-effort / Tier 2 — named support /
                       Tier 3 — enterprise/regulated]
Coverage window:      [e.g. Mon–Fri 09:00–18:00 UTC, 24x7, etc.]
Response targets:
  - Severity 1 (critical: data loss, security incident, total outage): [target, e.g. 1h]
  - Severity 2 (major: core workflow blocked): [target, e.g. 4h]
  - Severity 3 (minor: workaround exists): [target, e.g. 1 business day]
  - Severity 4 (cosmetic/question): [target, e.g. 3 business days]
Resolution/update cadence: [e.g. update at least every 8h until resolution]
Escalation path: [owner names + contact per tier]
Exclusions: [experimental domains not supported; unqualified workflows; etc.]
SLA start/end: [dates]
```

- Severity definitions must be fixed in the signed SLA.
- Experimental releases (R0 experimental channel) are explicitly **outside** any SLA unless a signed SLA says otherwise.

---

## 4. Release process

### 4.1 Branching model (trunk-based, minimal)

| Branch             | Purpose                                                      | Rules                                                                                                                |
| ------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `main` / `master`  | Single source of truth; continuous development               | Never force-push; always reviewed; CI must run on every push (hosted execution currently blocked — EXTERNAL-BLOCKED) |
| `release/<semver>` | Cut from `main` at a release-go pass; patch/maintenance line | Only tagged fixes and release-notes changes; no feature work                                                         |
| `experimental/*`   | Long-lived feature/domain experiment tracks                  | Must be labeled experimental; never merged to a release branch unless qualified                                      |

Release branch cuts require: an approved release manifest, a passing release-go checklist, and a recorded license/EULA decision.

### 4.2 Tagging

- Tags are signed, annotated, semver-formatted: `v<major>.<minor>.<patch>` (e.g. `v0.9.0`), with optional pre-release suffix for experimental builds: `v0.9.0-exp.1`.
- Every release tag points at the exact commit whose tree produced the verified package (byte-match evidence in the packaging report for at least the checked runtime files).
- Never move or delete a published tag once a package is distributed.

### 4.3 Release notes

Required for every release candidate and every shipped release:

- Date, semver, release type (experimental vs industrial — §7), train (e.g. R0).
- Domains covered and their maturity (experimental / qualified).
- Changed behavior and new routes; removed routes; fail-closed changes.
- Known limitations and open blocking gates (NASA TMR, hosted CI, signing, etc.).
- Verification summary: suite counts, V&V counts, coverage, gates, packaging evidence.
- License/EULA decision reference; third-party notice reference; SBOM reference.
- Rollback guidance (§4.4).

### 4.4 Rollback

- **Packaged app:** prior release tag + prior verified package artifact are always retained. If the new release cannot be verified on a supported host, the prior tag is the rollback target. Installer/update/rollback mechanics are currently **unverified** and must be demonstrated before an industrial release (M5 exit).
- **Source:** revert to prior tag via `git revert` of the release merge or `git checkout <prior-tag>`; never mutate history.
- **Data:** documented in `docs/known_limitations.md` — full project open/save/recovery is still incomplete; rollback of user project data is not supported today.
- Rollback decision records are logged with the incident (see §5).

---

## 5. Incident and security reporting policy

### 5.1 Reporting channels

| Reporter                         | Channel                                                                                                                                       | Target   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| End users (experimental channel) | Repository issue tracker (when available) or `docs/industrialization/status.md` change log                                                    | Public   |
| Security researchers             | Private disclosure: project maintainers via the repository's configured security contact (to be published once a remote/issue tracker exists) | Private  |
| Product team internal            | Escalation per §3; first responder is the release owner                                                                                       | Internal |

### 5.2 Handling

1. **Triage (24h target):** confirm scope, severity, affected versions; assign incident owner.
2. **Containment:** if severe, freeze release train; cut a patched branch; prepare rollback note (§4.4).
3. **Fix:** reproduce, patch, and pass the full gate set for the affected scope (lint, typecheck, syntax, IPC, renderer-sink, audit, V&V, coverage, packaging).
4. **Disclosure:** coordinate disclosure with affected parties before public posting; record CVE/GHSA identifiers when applicable.
5. **Post-incident report:** root cause, timeline, fix evidence, regressions tests, release notes entry.

### 5.3 Security reporting commitments (current state)

- Dependency advisories: `npm audit --audit-level=high` is a required gate; currently 0 vulnerabilities after the Electron 45.1.0 upgrade.
- Secret scan: production-source credential-pattern scan runs as a gate; no literal password/secret/API-key assignments found.
- Security posture doc: `docs/industrialization/security_posture.md` (superseded Electron 34 findings preserved as history); threat model: `docs/security/threat_model.md`.
- Open items: no hosted CI results, unsigned packages, no penetration testing, no independent security review.

---

## 6. Versioning policy (semver)

- The Product follows **Semantic Versioning 2.0.0** on the MAJOR.MINOR.PATCH form.
- `MAJOR`: incompatible public/API or IPC behavior changes; release-type changes (experimental → industrial for a domain); license/EULA changes that alter distribution rights.
- `MINOR`: backward-compatible new capabilities, domains, or routes.
- `PATCH`: backward-compatible fixes, remediation, documentation, packaging corrections.
- Pre-release metadata: `-exp.N` for experimental channel builds; `-rc.N` for release candidates.
- Current version: `1.0.0` (inherited) — a baseline `0.x` or `1.0.0` re-baseline decision is part of the release-go checklist; versioning that implies release readiness is **not** permitted until the manifest is signed.

---

## 7. Release-go checklist (per release type)

### 7.1 Checklist (common core)

- [ ] License/EULA decision recorded (§2.3) for this release
- [ ] Release notes drafted (§4.3)
- [ ] Tag created and signed; tree matches verified package byte-for-byte for checked runtime files
- [ ] Full local gate set passes: `npm test` (root suite), `test:vv` (fail-closed), coverage floor, lint, typecheck, syntax, IPC registration, renderer-sink inventory, formatting, `npm audit`, `git diff --check`
- [ ] SBOM regenerated for the release lockfile; third-party notices updated
- [ ] Known limitations section updated; no claim of validation/certification for unqualified domains
- [ ] Rollback target recorded (§4.4)

### 7.2 Experimental release (R0 experimental channel)

- [ ] All common-core items
- [ ] Experimental status clearly labeled in the product UI, README, release notes, and package metadata
- [ ] V&V report attached (pass/unavailable/fail counts) with the NASA TMR failure declared rather than hidden
- [ ] No support SLA implied; experimental disclaimer included
- [ ] Package unsigned status disclosed if signing not completed (signing is not a blocker for experimental channel, but must be disclosed)

### 7.3 Industrial release (qualified domain/packaged release)

Everything in experimental, plus:

- [ ] Rights-holder license/EULA approved text shipped in package and documentation
- [ ] Supported-OS matrix evidence (current: Windows 11 x64, macOS 13+, Linux CI runners) from **hosted** execution — hosted execution is EXTERNAL-BLOCKED today
- [ ] Signed/notarized packages where applicable; code-signing identity available
- [ ] Cold-install, update, and rollback evidence on a supported host
- [ ] M5 engineering exit: candidate manifest signed off by responsible product/domain/security owners; unresolved critical/high issues and in-scope capability gaps block release
- [ ] Independent review of engineering/regulatory claims where applicable
- [ ] Per-domain qualification dossiers complete for every domain included in the release
- [ ] Support contacts named per §3; SLA signed if support is offered

---

## 8. References

- `docs/industrialization/decisions/ADR-0001-experimental-maturity.md`
- `docs/industrialization/decisions/ADR-0002-fail-closed-validation-service.md`
- `docs/industrialization/decisions/ADR-0003-license-eula-pending.md`
- `docs/industrialization/EULA_DRAFT.md` (draft, not approved)
- `docs/industrialization/status.md` (verified progress and gates)
- `docs/industrialization/mercury_inception/IMPLEMENTATION_PLAN.md` (milestone exit criteria)
- `docs/industrialization/readiness_scorecard.md` (10-dimension scorecard)
- `docs/industrialization/implementation_plan_tracker.md` (phase tracker)
- `docs/industrialization/packaging_report.md`, `docs/industrialization/security_posture.md`, `docs/third_party_notices.md`
- `docs/known_limitations.md`
